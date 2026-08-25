import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionMutationClaim } from '../../../domain/contracts/subscription-mutation-claim-repository.contract';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { decodeSubscriptionMutationIntent } from '../../../domain/internal/subscription-mutation-intent';

const PROJECTING_OPERATIONS = new Set<SubscriptionMutationClaim['operation']>([
  'subscription_swap',
  'subscription_quantity_update',
]);
const NON_PROJECTING_OPERATIONS = new Set<SubscriptionMutationClaim['operation']>([
  'subscription_cancel',
  'subscription_cancel_now',
  'subscription_cancel_scheduled_change',
  'subscription_pause',
  'subscription_pause_payment_collection',
  'subscription_resume',
  'subscription_resume_paused',
  'subscription_resume_payment_collection',
  'subscription_change_apply',
]);

export async function resolveSubscriptionMutationClaim(
  repositories: Repositories,
  claim: SubscriptionMutationClaim,
  outcome: 'applied' | 'not_applied',
  evidenceReference: string,
  resolvedAt: Date,
): Promise<SubscriptionMutationClaim> {
  if (claim.status === 'resolved') {
    if (
      claim.resolutionOutcome === outcome &&
      claim.resolutionEvidenceReference === evidenceReference
    ) {
      return claim;
    }
    throw claimConflict(claim.claimReference);
  }
  if (claim.operation === 'subscription_price_migration') {
    throw claimConflict(claim.claimReference);
  }
  if (outcome === 'applied') {
    if (PROJECTING_OPERATIONS.has(claim.operation)) {
      await projectDirectMutation(repositories, claim);
    }
    if (
      !PROJECTING_OPERATIONS.has(claim.operation) &&
      !NON_PROJECTING_OPERATIONS.has(claim.operation)
    ) {
      throw claimConflict(claim.claimReference);
    }
  }
  const resolved = await repositories.subscriptionMutationClaims.resolve({
    claimReference: claim.claimReference,
    tenantId: claim.tenantId,
    expectedOwnerToken: claim.ownerToken,
    outcome,
    evidenceReference,
    resolvedAt,
  });
  if (!resolved) throw claimConflict(claim.claimReference);
  await recordResolution(repositories, claim, resolved);
  return resolved;
}

export async function observeSubscriptionMutationClaim(
  repositories: Repositories,
  claim: SubscriptionMutationClaim,
  evidenceReference: string,
  observedAt: Date,
): Promise<SubscriptionMutationClaim> {
  if (claim.status !== 'active') throw claimConflict(claim.claimReference);
  if (claim.observationOutcome === 'unknown') {
    if (claim.observationEvidenceReference === evidenceReference) return claim;
    throw claimConflict(claim.claimReference);
  }
  const observed = await repositories.subscriptionMutationClaims.observe({
    claimReference: claim.claimReference,
    tenantId: claim.tenantId,
    expectedOwnerToken: claim.ownerToken,
    outcome: 'unknown',
    evidenceReference,
    observedAt,
  });
  if (!observed) throw claimConflict(claim.claimReference);
  const payload = {
    claimReference: observed.claimReference,
    subscriptionId: observed.subscriptionId,
    operation: observed.operation,
    outcome: observed.observationOutcome,
    evidenceReference: observed.observationEvidenceReference,
  };
  await repositories.auditLogs.create({
    tenantId: observed.tenantId,
    correlationId: observed.correlationId,
    actorType: 'system',
    actorId: null,
    action: 'subscription.mutation_claim.observed',
    resourceType: 'subscription_mutation_claim',
    resourceId: observed.claimReference,
    before: { status: claim.status },
    after: payload,
    metadata: null,
    ipAddress: null,
    userAgent: null,
  });
  await repositories.outboxEvents.create({
    tenantId: observed.tenantId,
    correlationId: observed.correlationId,
    eventType: 'subscription.mutation_claim.observed.v1',
    eventVersion: 1,
    payload,
    dedupeKey: `subscription-mutation-claim:${observed.claimReference}:observed`,
  });
  return observed;
}

async function projectDirectMutation(
  repositories: Repositories,
  claim: SubscriptionMutationClaim,
): Promise<void> {
  if (!claim.intent) throw claimConflict(claim.claimReference);
  const projection = decodeSubscriptionMutationIntent(claim.intent);
  const items = await repositories.subscriptionItems.listBySubscription(
    claim.subscriptionId,
    claim.tenantId,
  );
  const item = items.find(({ id }) => id === projection.itemId);
  const subscription = await repositories.subscriptions.findById(
    claim.subscriptionId,
    claim.tenantId,
  );
  if (!item || !subscription) throw claimConflict(claim.claimReference);
  const itemAtSource = sameMutationValue(item, projection.source);
  const itemAtTarget = sameMutationValue(item, projection.target);
  const subscriptionAtSource = subscriptionMatchesProjection(
    subscription,
    projection.source,
    projection,
  );
  const subscriptionAtTarget = subscriptionMatchesProjection(
    subscription,
    projection.target,
    projection,
  );
  if (itemAtTarget && subscriptionAtTarget) return;
  if (!itemAtSource || !subscriptionAtSource) throw claimConflict(claim.claimReference);
  if (projection.projectItem) {
    await repositories.subscriptionItems.updateById(
      claim.subscriptionId,
      projection.itemId,
      { priceId: projection.target.priceId, quantity: projection.target.quantity },
      claim.tenantId,
    );
  }
  if (projection.projectSubscriptionPrice || projection.projectSubscriptionQuantity) {
    await repositories.subscriptions.update(
      claim.subscriptionId,
      {
        ...(projection.projectSubscriptionPrice ? { priceId: projection.target.priceId } : {}),
        ...(projection.projectSubscriptionQuantity
          ? {
              quantity: projection.target.quantity,
              ...(subscription.acceptedQuantity === null
                ? {}
                : { acceptedQuantity: projection.target.quantity }),
            }
          : {}),
      },
      claim.tenantId,
    );
  }
}

function sameMutationValue(
  item: { priceId: string; quantity: number },
  value: { priceId: string; quantity: number },
): boolean {
  return item.priceId === value.priceId && item.quantity === value.quantity;
}

function subscriptionMatchesProjection(
  subscription: {
    priceId: string | null;
    quantity: number;
    acceptedQuantity: number | null;
  },
  value: { priceId: string; quantity: number },
  projection: {
    projectSubscriptionPrice: boolean;
    projectSubscriptionQuantity: boolean;
  },
): boolean {
  return (
    (!projection.projectSubscriptionPrice || subscription.priceId === value.priceId) &&
    (!projection.projectSubscriptionQuantity ||
      (subscription.quantity === value.quantity &&
        (subscription.acceptedQuantity === null ||
          subscription.acceptedQuantity === value.quantity)))
  );
}

async function recordResolution(
  repositories: Repositories,
  before: SubscriptionMutationClaim,
  after: SubscriptionMutationClaim,
): Promise<void> {
  const payload = {
    claimReference: after.claimReference,
    subscriptionId: after.subscriptionId,
    operation: after.operation,
    outcome: after.resolutionOutcome,
    evidenceReference: after.resolutionEvidenceReference,
  };
  await repositories.auditLogs.create({
    tenantId: after.tenantId,
    correlationId: after.correlationId,
    actorType: 'system',
    actorId: null,
    action: 'subscription.mutation_claim.resolved',
    resourceType: 'subscription_mutation_claim',
    resourceId: after.claimReference,
    before: { status: before.status },
    after: payload,
    metadata: null,
    ipAddress: null,
    userAgent: null,
  });
  await repositories.outboxEvents.create({
    tenantId: after.tenantId,
    correlationId: after.correlationId,
    eventType: 'subscription.mutation_claim.resolved.v1',
    eventVersion: 1,
    payload,
    dedupeKey: `subscription-mutation-claim:${after.claimReference}:resolved`,
  });
}

export function claimConflict(claimReference: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    'Subscription mutation claim does not permit this operation',
    'SUBSCRIPTION_MUTATION_CLAIM_CONFLICT',
    { context: { claimReference } },
  );
}
