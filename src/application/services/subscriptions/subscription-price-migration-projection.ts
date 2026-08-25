import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { reconcileSubscriptionStatus } from '../../../domain/states/subscription-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { releaseSubscriptionMutationClaim } from './subscription-mutation-claim';
import { completeSubscriptionPriceMigration } from './subscription-price-migration-claim';
import {
  assertSubscriptionMigrationCanonicalSource,
  type PreparedSubscriptionPriceMigrationExecution,
} from './subscription-price-migration-preparation';
import { recordSubscriptionPriceMigrationTransition } from './subscription-price-migration-transition';

export type ClaimedPreparedSubscriptionPriceMigration =
  PreparedSubscriptionPriceMigrationExecution & {
    migration: SubscriptionPriceMigration & { status: 'executing'; executionToken: string };
  };

export async function projectSubscriptionPriceMigrationSuccess(
  repositories: Repositories,
  prepared: ClaimedPreparedSubscriptionPriceMigration,
  providerStatus: Subscription['status'],
  tenantId: string | null,
  now: Date,
): Promise<SubscriptionPriceMigration> {
  await assertSubscriptionMigrationCanonicalSource(repositories, prepared.migration, tenantId);
  if (prepared.migration.effectiveTiming === 'nextRenewal') {
    const pending = await completeSubscriptionPriceMigration(
      repositories,
      prepared.migration,
      { status: 'pending_renewal' },
      now,
    );
    await recordSubscriptionPriceMigrationTransition(
      repositories,
      prepared.migration,
      pending,
      CorrelationId.generate().toString(),
      now,
    );
    return pending;
  }
  await projectApprovedSubscriptionPriceMigration(
    repositories,
    prepared.migration,
    prepared.subscription,
    providerStatus,
    tenantId,
  );
  const applied = await completeSubscriptionPriceMigration(
    repositories,
    prepared.migration,
    { status: 'applied' },
    now,
  );
  await recordSubscriptionPriceMigrationTransition(
    repositories,
    prepared.migration,
    applied,
    CorrelationId.generate().toString(),
    now,
  );
  await releaseSubscriptionMutationClaim(repositories, {
    tenantId,
    subscriptionId: prepared.migration.subscriptionId,
    ownerToken: prepared.migration.executionToken,
  });
  return applied;
}

export async function projectApprovedSubscriptionPriceMigration(
  repositories: Repositories,
  migration: SubscriptionPriceMigration,
  subscription: Subscription,
  providerStatus: Subscription['status'],
  tenantId: string | null,
): Promise<void> {
  const targetItem = approvedMigratedItem(migration);
  await projectItems(repositories, migration, tenantId);
  const changesPrimary = targetItem.id === migration.primaryItemId;
  const target = migration.targetPrice;
  await repositories.subscriptions.update(
    subscription.id,
    {
      status: reconcileSubscriptionStatus(subscription.status, providerStatus).status,
      ...(changesPrimary
        ? {
            priceId: target.id,
            quantity: targetItem.quantity,
            canonicalPriceId: target.id,
            canonicalProductId: target.productId,
            acceptedCurrency: target.currency,
            acceptedUnitAmount: target.amount,
            acceptedInterval: target.interval as Subscription['acceptedInterval'],
            acceptedIntervalCount: target.intervalCount,
            acceptedQuantity: targetItem.quantity,
          }
        : {}),
    },
    tenantId,
  );
}

function approvedMigratedItem(
  migration: SubscriptionPriceMigration,
): SubscriptionPriceMigration['proposedItems'][number] {
  const candidates = migration.proposedItems.filter((proposed) => {
    const current = migration.currentItems.find(({ id }) => id === proposed.id);
    return (
      current?.priceId === migration.sourcePriceId &&
      proposed.priceId === migration.targetPriceId &&
      (current.priceId !== proposed.priceId || current.quantity !== proposed.quantity)
    );
  });
  const migrated = candidates[0];
  if (!migrated || candidates.length !== 1) {
    throw new TypeError('Approved migration item identity is ambiguous');
  }
  return migrated;
}

async function projectItems(
  repositories: Repositories,
  migration: SubscriptionPriceMigration,
  tenantId: string | null,
): Promise<void> {
  for (const proposed of migration.proposedItems) {
    const current = migration.currentItems.find(({ id }) => id === proposed.id);
    if (
      !current ||
      (current.priceId === proposed.priceId && current.quantity === proposed.quantity)
    ) {
      continue;
    }
    await repositories.subscriptionItems.updateById(
      migration.subscriptionId,
      proposed.id,
      { priceId: proposed.priceId, quantity: proposed.quantity },
      tenantId,
    );
  }
}
