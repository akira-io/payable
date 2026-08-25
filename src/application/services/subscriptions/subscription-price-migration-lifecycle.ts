import type { CollectionPage } from '../../../domain/dtos/collection-page.dto';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import { hashRequest } from '../../../support/hash/request-hash';
import type { LocalDependencies } from '../../builders/local-dependencies';
import type {
  DueSubscriptionPriceMigrationsInput,
  ResolveSubscriptionPriceMigrationInput,
  SubscriptionPriceMigrationOperationInput,
} from '../../builders/subscription-price-migration-resource.contract';
import { decodeCollectionCursor, encodeCollectionCursor } from '../collections/collection-cursor';
import { normalizeCollectionLimit } from '../collections/normalize-collection-query';
import { SubscriptionPriceMigrationExecutor } from './subscription-price-migration-executor';
import { resolveSubscriptionPriceMigrationReconciliation } from './subscription-price-migration-reconciliation';
import { settleSubscriptionPriceMigration } from './subscription-price-migration-settlement';

type LifecycleOperation = 'approve' | 'execute' | 'settle' | 'cancel' | 'retry' | 'resolve';

export class SubscriptionPriceMigrationLifecycle {
  constructor(private readonly dependencies: LocalDependencies) {}

  approve(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return this.operation('approve', id, input, async (executor, migration) => {
      if (
        migration.status === 'applied' ||
        migration.status === 'pending_renewal' ||
        migration.status === 'scheduled'
      ) {
        return migration;
      }
      return migration.effectiveTiming === 'scheduled'
        ? executor.schedule(id)
        : executor.execute(id, 'previewed');
    });
  }

  execute(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return this.operation('execute', id, input, (executor, migration) =>
      migration.status === 'applied' ? migration : executor.execute(id, 'scheduled'),
    );
  }

  settle(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return this.operation('settle', id, input, (_executor, migration) => {
      const storage = this.dependencies.storage;
      if (!storage) throw storageRequired();
      return storage.transaction((repositories) =>
        settleSubscriptionPriceMigration(repositories, this.dependencies, migration),
      );
    });
  }

  retry(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return this.operation('retry', id, input, (executor, migration) => {
      if (migration.status === 'reconciliation_required') throw reconciliationRequired(id);
      if (migration.status !== 'failed') throw stateConflict(id);
      return executor.execute(id, 'failed');
    });
  }

  cancel(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return this.operation('cancel', id, input, (executor) => executor.cancel(id));
  }

  resolve(id: string, input: ResolveSubscriptionPriceMigrationInput) {
    assertResolutionInput(input);
    return this.operation('resolve', id, input, () => {
      const storage = this.dependencies.storage;
      if (!storage) throw storageRequired();
      return storage.transaction((repositories) =>
        resolveSubscriptionPriceMigrationReconciliation(repositories, this.dependencies, id, input),
      );
    });
  }

  async due(
    input: DueSubscriptionPriceMigrationsInput,
  ): Promise<CollectionPage<SubscriptionPriceMigration>> {
    if (!(input.dueBefore instanceof Date) || Number.isNaN(input.dueBefore.getTime())) {
      throw new TypeError('dueBefore must be a valid Date');
    }
    const limit = normalizeCollectionLimit(input.limit);
    const tenantId = this.tenantId();
    const context = {
      resource: 'subscription-price-migrations-due',
      tenantId,
      filters: { dueBefore: input.dueBefore.toISOString() },
      orderVersion: 'effective_at_asc_id_asc_v1',
    };
    const decoded = input.cursor ? decodeCollectionCursor(input.cursor, context) : undefined;
    const page = await this.repository().pageDueScheduled(
      {
        limit,
        dueBefore: input.dueBefore,
        before: decoded ? { effectiveAt: decoded.createdAt, id: decoded.id } : undefined,
      },
      tenantId,
    );
    const last = page.items.at(-1);
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextCursor:
        page.hasMore && last?.effectiveAt
          ? encodeCollectionCursor({ createdAt: last.effectiveAt, id: last.id }, context)
          : null,
    };
  }

  private async operation(
    operation: LifecycleOperation,
    id: string,
    input: SubscriptionPriceMigrationOperationInput | ResolveSubscriptionPriceMigrationInput,
    run: (
      executor: SubscriptionPriceMigrationExecutor,
      migration: SubscriptionPriceMigration,
    ) => Promise<SubscriptionPriceMigration> | SubscriptionPriceMigration,
  ): Promise<SubscriptionPriceMigration> {
    const idempotency = this.dependencies.subscriptionChangeIdempotency;
    if (!idempotency) throw storageRequired();
    const tenantId = this.tenantId();
    const key = IdempotencyKey.of(input.idempotencyKey).toString();
    const reference = await idempotency.execute<{ migrationId: string }>({
      key,
      storageKey: `subscription-price-migration-${operation}:v1:${await hashRequest([
        tenantId,
        id,
        key,
      ])}`,
      scope: `subscription-price-migration-${operation}`,
      operation,
      request: {
        migrationId: id,
        operation,
        ...('outcome' in input
          ? { outcome: input.outcome, evidenceReference: input.evidenceReference }
          : {}),
      },
      resourceType: 'subscription-price-migration',
      resourceId: id,
      tenantId,
      retryFailed: false,
      failurePolicy: 'reconciliation-required',
      run: async () => {
        const migration = await this.retrieve(id);
        await run(new SubscriptionPriceMigrationExecutor(this.dependencies), migration);
        return { migrationId: id };
      },
      revive: reviveMigrationReference,
    });
    return this.retrieve(reference.migrationId);
  }

  private async retrieve(id: string): Promise<SubscriptionPriceMigration> {
    const migration = await this.repository().findById(id, this.tenantId());
    if (!migration) {
      throw new SubscriptionPriceMigrationError(
        `Subscription migration not found: ${id}`,
        'SUBSCRIPTION_MIGRATION_NOT_FOUND',
        { context: { migrationId: id } },
      );
    }
    return migration;
  }

  private repository() {
    const repository = this.dependencies.storage?.subscriptionPriceMigrations;
    if (!repository) throw storageRequired();
    return repository;
  }

  private tenantId(): string | null {
    return this.dependencies.tenantId ?? null;
  }
}

function assertResolutionInput(input: ResolveSubscriptionPriceMigrationInput): void {
  if (
    !['applied', 'not_applied', 'unknown'].includes(input.outcome) ||
    typeof input.evidenceReference !== 'string' ||
    input.evidenceReference.length === 0 ||
    input.evidenceReference.length > 512 ||
    input.evidenceReference.trim() !== input.evidenceReference
  ) {
    throw new TypeError('A reconciliation outcome and evidence reference are required');
  }
}

function storageRequired(): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription migration lifecycle requires durable canonical storage and idempotency',
    'SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED',
  );
}

function reviveMigrationReference(value: unknown): { migrationId: string } {
  const migrationId = (value as { migrationId?: unknown } | null)?.migrationId;
  if (typeof migrationId !== 'string' || migrationId.length === 0) throw staleReference();
  return { migrationId };
}

function staleReference(): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Stored subscription migration reference is invalid',
    'SUBSCRIPTION_MIGRATION_PREVIEW_STALE',
  );
}

function stateConflict(id: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription migration state does not permit this operation',
    'SUBSCRIPTION_MIGRATION_STATE_CONFLICT',
    { context: { migrationId: id } },
  );
}

function reconciliationRequired(id: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription migration requires reconciliation',
    'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED',
    { context: { migrationId: id } },
  );
}
