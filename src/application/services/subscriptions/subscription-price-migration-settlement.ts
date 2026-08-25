import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { LocalDependencies } from '../../builders/local-dependencies';
import { releaseSubscriptionMutationClaim } from './subscription-mutation-claim';
import { stateConflict } from './subscription-price-migration-claim';
import { assertSubscriptionMigrationCanonicalSource } from './subscription-price-migration-preparation';
import { projectApprovedSubscriptionPriceMigration } from './subscription-price-migration-projection';
import { recordSubscriptionPriceMigrationTransition } from './subscription-price-migration-transition';

export async function settleSubscriptionPriceMigration(
  repositories: Repositories,
  dependencies: LocalDependencies,
  migration: SubscriptionPriceMigration,
): Promise<SubscriptionPriceMigration> {
  const renewalDate = migration.currentRenewalDate;
  const executionToken = migration.executionToken;
  if (
    migration.status !== 'pending_renewal' ||
    migration.effectiveTiming !== 'nextRenewal' ||
    renewalDate === null ||
    executionToken === null ||
    dependencies.clock.now().getTime() < renewalDate.getTime()
  ) {
    throw stateConflict(migration.id);
  }
  const tenantId = dependencies.tenantId ?? null;
  const subscription = await assertSubscriptionMigrationCanonicalSource(
    repositories,
    migration,
    tenantId,
    { allowRenewalDateAdvance: true },
  );
  await projectApprovedSubscriptionPriceMigration(
    repositories,
    migration,
    subscription,
    subscription.status,
    tenantId,
  );
  const now = dependencies.clock.now();
  const applied = await repositories.subscriptionPriceMigrations.compareAndSwapState({
    id: migration.id,
    tenantId,
    expectedStatus: 'pending_renewal',
    expectedExecutionToken: executionToken,
    nextStatus: 'applied',
    executionToken,
    attemptCount: migration.attemptCount,
    failureCode: null,
    failureMessage: null,
    scheduledAt: migration.scheduledAt,
    executionStartedAt: migration.executionStartedAt,
    appliedAt: now,
    failedAt: null,
    reconciliationRequiredAt: migration.reconciliationRequiredAt,
    cancelledAt: null,
    updatedAt: now,
  });
  if (!applied) throw stateConflict(migration.id);
  await releaseSubscriptionMutationClaim(repositories, {
    tenantId,
    subscriptionId: migration.subscriptionId,
    ownerToken: executionToken,
  });
  await recordSubscriptionPriceMigrationTransition(
    repositories,
    migration,
    applied,
    CorrelationId.generate().toString(),
    now,
  );
  return applied;
}
