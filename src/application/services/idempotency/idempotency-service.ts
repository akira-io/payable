import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  IdempotencyRecord,
  IdempotencyStore,
} from '../../../domain/contracts/idempotency-store.contract';
import { IdempotencyConflictError } from '../../../domain/errors/idempotency-conflict.error';
import { IdempotencyInProgressError } from '../../../domain/errors/idempotency-in-progress.error';
import { IdempotencyReconciliationRequiredError } from '../../../domain/errors/idempotency-reconciliation-required.error';
import { IdempotencyResultPersistenceError } from '../../../domain/errors/idempotency-result-persistence.error';
import { hashRequest } from '../../../support/hash/request-hash';

type IdempotencyFailurePolicy = 'default' | 'reconciliation-required';

interface ResolvedIdempotencyPolicy {
  retryFailed: boolean;
  reclaimStaleProcessing: boolean;
  lockTtlMs: number;
  failedTtlMs: number;
  failurePolicy: IdempotencyFailurePolicy;
}

export interface IdempotentExecution<T> {
  key: string;
  storageKey?: string;
  scope: string;
  operation: string;
  request: unknown;
  resourceType?: string | null;
  resourceId?: string | null;
  tenantId?: string | null;
  retryFailed?: boolean;
  reclaimStaleProcessing?: boolean;
  lockTtlMs?: number;
  failurePolicy?: IdempotencyFailurePolicy;
  correlationId?: string;
  run: () => Promise<T>;
  revive?: (response: unknown) => Promise<T> | T;
}

export interface IdempotencyServiceOptions {
  lockTtlMs?: number;
  retryFailed?: boolean;
  completedTtlMs?: number;
  failedTtlMs?: number;
}

export class IdempotencyService {
  private readonly lockTtlMs: number;
  private readonly retryFailed: boolean;
  private readonly completedTtlMs: number;
  private readonly failedTtlMs: number;

  constructor(
    private readonly store: IdempotencyStore,
    private readonly clock: Clock,
    options: IdempotencyServiceOptions = {},
  ) {
    this.lockTtlMs = options.lockTtlMs ?? 30_000;
    this.retryFailed = options.retryFailed ?? true;
    this.completedTtlMs = options.completedTtlMs ?? 86_400_000;
    this.failedTtlMs = options.failedTtlMs ?? this.lockTtlMs;
  }

  async execute<T>(execution: IdempotentExecution<T>): Promise<T> {
    const requestHash = await hashRequest(execution.request);
    const executionPolicy = this.resolvePolicy(execution);
    const existing = await this.store.find(this.scopedKey(execution), execution.tenantId);
    const replay = this.replay<T>(existing, requestHash, execution.key, executionPolicy);
    if (replay.handled) {
      return execution.revive ? await execution.revive(replay.value) : (replay.value as T);
    }
    return this.run(execution, requestHash, executionPolicy);
  }

  private resolvePolicy(execution: IdempotentExecution<unknown>): ResolvedIdempotencyPolicy {
    if (execution.failurePolicy === 'reconciliation-required') {
      return {
        retryFailed: false,
        reclaimStaleProcessing: true,
        lockTtlMs: this.completedTtlMs,
        failedTtlMs: this.completedTtlMs,
        failurePolicy: execution.failurePolicy,
      };
    }
    return {
      retryFailed: execution.retryFailed ?? this.retryFailed,
      reclaimStaleProcessing: execution.reclaimStaleProcessing ?? false,
      lockTtlMs: execution.lockTtlMs ?? this.lockTtlMs,
      failedTtlMs: this.failedTtlMs,
      failurePolicy: 'default',
    };
  }

  private scopedKey(
    execution: Pick<IdempotentExecution<unknown>, 'scope' | 'key' | 'storageKey'>,
  ): string {
    return execution.storageKey ?? `${execution.scope}:${execution.key}`;
  }

  private replay<T>(
    existing: IdempotencyRecord | null,
    requestHash: string,
    key: string,
    policy: ResolvedIdempotencyPolicy,
  ): { handled: boolean; value?: T } {
    if (!existing) {
      return { handled: false };
    }
    if (this.isExpired(existing)) {
      return { handled: false };
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError(key);
    }
    if (existing.status === 'completed') {
      return { handled: true, value: existing.response as T };
    }
    if (existing.status === 'processing' && this.isLocked(existing)) {
      throw new IdempotencyInProgressError(key);
    }
    if (existing.status === 'failed' && !policy.retryFailed) {
      if (policy.failurePolicy === 'reconciliation-required') {
        throw new IdempotencyReconciliationRequiredError(key);
      }
      throw new IdempotencyConflictError(key);
    }
    return { handled: false };
  }

  private isLocked(record: IdempotencyRecord): boolean {
    return record.lockedUntil !== null && record.lockedUntil.getTime() > this.clock.now().getTime();
  }

  private isExpired(record: IdempotencyRecord): boolean {
    return record.expiresAt !== null && record.expiresAt.getTime() <= this.clock.now().getTime();
  }

  private async run<T>(
    execution: IdempotentExecution<T>,
    requestHash: string,
    policy: ResolvedIdempotencyPolicy,
  ): Promise<T> {
    const scopedKey = this.scopedKey(execution);
    const processingRecord = this.processingRecord(execution, requestHash, policy);
    const acquired = await this.store.acquire(processingRecord, execution.tenantId);
    if (!acquired) {
      const existing = await this.store.find(scopedKey, execution.tenantId);
      const replay = this.replay<T>(existing, requestHash, execution.key, policy);
      if (replay.handled) {
        return execution.revive ? await execution.revive(replay.value) : (replay.value as T);
      }
      if (existing?.status === 'processing' && !policy.reclaimStaleProcessing) {
        throw new IdempotencyInProgressError(execution.key);
      }
      const claimed = await this.store.takeOver(processingRecord, execution.tenantId);
      if (!claimed) {
        throw new IdempotencyInProgressError(execution.key);
      }
    }
    let executionResult: T;
    try {
      executionResult = await execution.run();
    } catch (error) {
      await this.markFailed(scopedKey, execution, processingRecord, policy.failedTtlMs);
      throw error;
    }

    const expiresAt = new Date(this.clock.now().getTime() + this.completedTtlMs);
    let completionError: unknown;
    try {
      await this.store.markCompleted(
        scopedKey,
        executionResult,
        execution.tenantId,
        processingRecord.lockToken,
        expiresAt,
      );
    } catch (error) {
      completionError = error;
    }

    let completedRecord: IdempotencyRecord | null = null;
    let verificationError: unknown;
    try {
      completedRecord = await this.store.find(scopedKey, execution.tenantId);
    } catch (error) {
      verificationError = error;
    }
    if (completedRecord?.status === 'completed' && completedRecord.requestHash === requestHash) {
      if (
        completionError === undefined &&
        completedRecord.lockToken === processingRecord.lockToken
      ) {
        return executionResult;
      }
      return execution.revive
        ? await execution.revive(completedRecord.response)
        : (completedRecord.response as T);
    }

    await this.markFailed(scopedKey, execution, processingRecord, policy.failedTtlMs);
    throw new IdempotencyResultPersistenceError(execution.key, {
      cause: completionError ?? verificationError,
      correlationId: execution.correlationId,
      context: execution.correlationId ? { correlationId: execution.correlationId } : undefined,
    });
  }

  private async markFailed<T>(
    scopedKey: string,
    execution: IdempotentExecution<T>,
    record: IdempotencyRecord,
    failedTtlMs: number,
  ): Promise<void> {
    const failedExpiresAt = new Date(this.clock.now().getTime() + failedTtlMs);
    await this.store
      .markFailed(scopedKey, execution.tenantId, record.lockToken, failedExpiresAt)
      .catch(() => {});
  }

  private processingRecord<T>(
    execution: IdempotentExecution<T>,
    requestHash: string,
    policy: ResolvedIdempotencyPolicy,
  ): IdempotencyRecord {
    return {
      key: this.scopedKey(execution),
      scope: execution.scope,
      operation: execution.operation,
      resourceType: execution.resourceType ?? null,
      resourceId: execution.resourceId ?? null,
      requestHash,
      response: null,
      status: 'processing',
      lockedUntil: new Date(this.clock.now().getTime() + policy.lockTtlMs),
      expiresAt: null,
      lockToken: globalThis.crypto.randomUUID(),
    };
  }
}
