import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { LocalDependencies } from '../../builders/local-dependencies';
import { stateConflict } from './subscription-price-migration-claim';
import {
  prepareSubscriptionPriceMigration,
  staleSubscriptionMigration,
} from './subscription-price-migration-preparation';
import { recordSubscriptionPriceMigrationTransition } from './subscription-price-migration-transition';

export async function scheduleSubscriptionPriceMigration(
  repositories: Repositories,
  migration: SubscriptionPriceMigration,
  dependencies: LocalDependencies,
): Promise<SubscriptionPriceMigration> {
  if (migration.status !== 'previewed' || migration.effectiveTiming !== 'scheduled') {
    throw stateConflict(migration.id);
  }
  if (migration.expiresAt.getTime() <= dependencies.clock.now().getTime()) {
    throw staleSubscriptionMigration(migration.id);
  }
  await prepareSubscriptionPriceMigration(repositories, migration, dependencies);
  const now = dependencies.clock.now();
  const scheduled = await repositories.subscriptionPriceMigrations.compareAndSwapState({
    id: migration.id,
    tenantId: dependencies.tenantId ?? null,
    expectedStatus: 'previewed',
    expectedExecutionToken: null,
    nextStatus: 'scheduled',
    executionToken: null,
    attemptCount: 0,
    failureCode: null,
    failureMessage: null,
    scheduledAt: now,
    executionStartedAt: null,
    appliedAt: null,
    failedAt: null,
    reconciliationRequiredAt: null,
    cancelledAt: null,
    updatedAt: now,
  });
  if (!scheduled) throw stateConflict(migration.id);
  await recordSubscriptionPriceMigrationTransition(
    repositories,
    migration,
    scheduled,
    CorrelationId.generate().toString(),
    now,
  );
  return scheduled;
}
