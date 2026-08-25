import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import {
  type SubscriptionPriceMigrationFailureCode,
  subscriptionPriceMigrationFailure,
} from '../../../domain/value-objects/subscription-price-migration-failure';

export async function claimSubscriptionPriceMigration(
  repositories: Repositories,
  migration: SubscriptionPriceMigration,
  executionToken: string,
  now: Date,
): Promise<SubscriptionPriceMigration> {
  if (migration.status === 'failed') {
    const active = await repositories.subscriptionPriceMigrations.findActiveBySubscriptionId(
      migration.subscriptionId,
      migration.tenantId,
    );
    if (active && active.id !== migration.id) throw stateConflict(migration.id);
  }
  const claimed = await repositories.subscriptionPriceMigrations.compareAndSwapState({
    id: migration.id,
    tenantId: migration.tenantId,
    expectedStatus: migration.status as 'previewed' | 'scheduled' | 'failed',
    expectedExecutionToken: null,
    nextStatus: 'executing',
    executionToken,
    attemptCount: migration.attemptCount + 1,
    failureCode: null,
    failureMessage: null,
    scheduledAt: migration.scheduledAt,
    executionStartedAt: now,
    appliedAt: null,
    failedAt: null,
    reconciliationRequiredAt: null,
    cancelledAt: null,
    updatedAt: now,
  });
  if (!claimed) throw stateConflict(migration.id);
  return claimed;
}

export async function completeSubscriptionPriceMigration(
  repositories: Repositories,
  migration: SubscriptionPriceMigration & { executionToken: string },
  completion:
    | { status: 'applied' | 'pending_renewal' }
    | {
        status: 'failed' | 'reconciliation_required';
        failureCode: SubscriptionPriceMigrationFailureCode;
      },
  now: Date,
): Promise<SubscriptionPriceMigration> {
  const failure =
    completion.status === 'failed' || completion.status === 'reconciliation_required'
      ? subscriptionPriceMigrationFailure(completion.failureCode)
      : { code: null, message: null };
  const shared = {
    id: migration.id,
    tenantId: migration.tenantId,
    expectedStatus: 'executing',
    expectedExecutionToken: migration.executionToken,
    attemptCount: migration.attemptCount,
    failureCode: failure.code,
    failureMessage: failure.message,
    scheduledAt: migration.scheduledAt,
    executionStartedAt: migration.executionStartedAt,
    appliedAt: completion.status === 'applied' ? now : null,
    failedAt: completion.status === 'failed' ? now : null,
    reconciliationRequiredAt: completion.status === 'reconciliation_required' ? now : null,
    cancelledAt: null,
    updatedAt: now,
  } as const;
  const completed =
    completion.status === 'failed'
      ? await repositories.subscriptionPriceMigrations.compareAndSwapState({
          ...shared,
          nextStatus: 'failed',
          executionToken: null,
        })
      : await repositories.subscriptionPriceMigrations.compareAndSwapState({
          ...shared,
          nextStatus: completion.status,
          executionToken: migration.executionToken,
        });
  if (!completed) throw stateConflict(migration.id);
  return completed;
}

export function claimedMigration(
  migration: SubscriptionPriceMigration,
): migration is SubscriptionPriceMigration & { status: 'executing'; executionToken: string } {
  return migration.status === 'executing' && migration.executionToken !== null;
}

export function stateConflict(id: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription migration state changed concurrently',
    'SUBSCRIPTION_MIGRATION_STATE_CONFLICT',
    { context: { migrationId: id } },
  );
}

export function reconciliationRequired(id: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription migration requires reconciliation',
    'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED',
    { context: { migrationId: id } },
  );
}
