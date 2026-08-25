import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { AcquireSubscriptionMutationClaim } from '../../../domain/contracts/subscription-mutation-claim-repository.contract';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';

export async function acquireSubscriptionMutationClaim(
  repositories: Repositories,
  input: AcquireSubscriptionMutationClaim,
): Promise<void> {
  if (await repositories.subscriptionMutationClaims.acquire(input)) return;
  const active = await repositories.subscriptionMutationClaims.findActiveBySubscriptionId(
    input.subscriptionId,
    input.tenantId,
  );
  if (active) throw ambiguousSubscriptionMutation(active.claimReference, active.correlationId);
  throw mutationConflict(input.subscriptionId);
}

export function ambiguousSubscriptionMutation(
  claimReference: string,
  correlationId: string,
): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription mutation requires reconciliation',
    'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
    { correlationId, context: { claimReference } },
  );
}

export async function releaseSubscriptionMutationClaim(
  repositories: Repositories,
  input: { tenantId: string | null; subscriptionId: string; ownerToken: string },
): Promise<void> {
  if (!(await repositories.subscriptionMutationClaims.release(input))) {
    throw mutationConflict(input.subscriptionId);
  }
}

function mutationConflict(subscriptionId: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription mutation is already in progress',
    'SUBSCRIPTION_MIGRATION_STATE_CONFLICT',
    { context: { subscriptionId } },
  );
}
