import type { SubscriptionPriceMigrationRepository } from '../../../domain/contracts/subscription-price-migration-repository.contract';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';

export async function assertNoActivePriceMigration(
  repository: SubscriptionPriceMigrationRepository,
  subscriptionId: string,
  tenantId: string | null,
): Promise<void> {
  if (await repository.findActiveBySubscriptionId(subscriptionId, tenantId)) {
    throw new SubscriptionPriceMigrationError(
      'An active migration already exists for this subscription',
      'SUBSCRIPTION_MIGRATION_STATE_CONFLICT',
      { context: { subscriptionId } },
    );
  }
}
