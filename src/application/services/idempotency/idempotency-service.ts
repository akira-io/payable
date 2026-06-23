import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  IdempotencyRecord,
  IdempotencyStore,
} from '../../../domain/contracts/idempotency-store.contract';
import { IdempotencyConflictError } from '../../../domain/errors/idempotency-conflict.error';
import { IdempotencyInProgressError } from '../../../domain/errors/idempotency-in-progress.error';
import { hashRequest } from '../../../support/hash/request-hash';

export interface IdempotentExecution<T> {
  key: string;
  scope: string;
  operation: string;
  request: unknown;
  resourceType?: string | null;
  resourceId?: string | null;
  tenantId?: string | null;
  retryFailed?: boolean;
  run: () => Promise<T>;
}

export interface IdempotencyServiceOptions {
  lockTtlMs?: number;
  retryFailed?: boolean;
}

export class IdempotencyService {
  private readonly lockTtlMs: number;
  private readonly retryFailed: boolean;

  constructor(
    private readonly store: IdempotencyStore,
    private readonly clock: Clock,
    options: IdempotencyServiceOptions = {},
  ) {
    this.lockTtlMs = options.lockTtlMs ?? 30_000;
    this.retryFailed = options.retryFailed ?? true;
  }

  async execute<T>(execution: IdempotentExecution<T>): Promise<T> {
    const requestHash = await hashRequest(execution.request);
    const retryFailed = execution.retryFailed ?? this.retryFailed;
    const existing = await this.store.find(execution.key, execution.tenantId);
    const replay = this.replay<T>(existing, requestHash, execution.key, retryFailed);
    if (replay.handled) {
      return replay.value as T;
    }
    return this.run(execution, requestHash, retryFailed);
  }

  private replay<T>(
    existing: IdempotencyRecord | null,
    requestHash: string,
    key: string,
    retryFailed: boolean,
  ): { handled: boolean; value?: T } {
    if (!existing) {
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
    if (existing.status === 'failed' && !retryFailed) {
      throw new IdempotencyConflictError(key);
    }
    return { handled: false };
  }

  private isLocked(record: IdempotencyRecord): boolean {
    return record.lockedUntil !== null && record.lockedUntil.getTime() > this.clock.now().getTime();
  }

  private async run<T>(
    execution: IdempotentExecution<T>,
    requestHash: string,
    retryFailed: boolean,
  ): Promise<T> {
    const record = this.processingRecord(execution, requestHash);
    const acquired = await this.store.acquire(record, execution.tenantId);
    if (!acquired) {
      const existing = await this.store.find(execution.key, execution.tenantId);
      const replay = this.replay<T>(existing, requestHash, execution.key, retryFailed);
      if (replay.handled) {
        return replay.value as T;
      }
      const claimed = await this.store.takeOver(record, execution.tenantId);
      if (!claimed) {
        throw new IdempotencyInProgressError(execution.key);
      }
    }
    try {
      const result = await execution.run();
      await this.store.markCompleted(execution.key, result, execution.tenantId);
      return result;
    } catch (error) {
      await this.store.markFailed(execution.key, execution.tenantId);
      throw error;
    }
  }

  private processingRecord<T>(
    execution: IdempotentExecution<T>,
    requestHash: string,
  ): IdempotencyRecord {
    return {
      key: execution.key,
      scope: execution.scope,
      operation: execution.operation,
      resourceType: execution.resourceType ?? null,
      resourceId: execution.resourceId ?? null,
      requestHash,
      response: null,
      status: 'processing',
      lockedUntil: new Date(this.clock.now().getTime() + this.lockTtlMs),
      expiresAt: null,
    };
  }
}
