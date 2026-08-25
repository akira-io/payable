import type { SubscriptionMutationClaim } from '../../domain/contracts/subscription-mutation-claim-repository.contract';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';
import { hashRequest } from '../../support/hash/request-hash';
import {
  claimConflict,
  observeSubscriptionMutationClaim,
  resolveSubscriptionMutationClaim,
} from '../services/subscriptions/subscription-mutation-claim-resolution';
import type { LocalDependencies } from './local-dependencies';
import type {
  ResolveSubscriptionMutationClaimInput,
  SubscriptionMutationClaimResource as SubscriptionMutationClaimResourceContract,
  SubscriptionMutationClaimView,
} from './subscription-mutation-claim-resource.contract';

export class SubscriptionMutationClaimResource
  implements SubscriptionMutationClaimResourceContract
{
  constructor(private readonly dependencies: LocalDependencies) {}

  async retrieve(claimReference: string): Promise<SubscriptionMutationClaimView> {
    const claim = await this.repository().findByReference(claimReference, this.tenantId());
    if (!claim) throw claimConflict(claimReference);
    return toView(claim);
  }

  async resolve(
    claimReference: string,
    input: ResolveSubscriptionMutationClaimInput,
  ): Promise<SubscriptionMutationClaimView> {
    assertResolutionInput(input);
    const idempotency = this.dependencies.subscriptionChangeIdempotency;
    const storage = this.dependencies.storage;
    if (!idempotency || !storage) throw claimConflict(claimReference);
    const key = IdempotencyKey.of(input.idempotencyKey).toString();
    const reference = await idempotency.execute<{ claimReference: string }>({
      key,
      storageKey: `subscription-mutation-claim-resolve:v1:${await hashRequest([
        this.tenantId(),
        claimReference,
        key,
      ])}`,
      scope: 'subscription-mutation-claim-resolve',
      operation: 'resolve',
      request: { claimReference, ...input },
      resourceType: 'subscription_mutation_claim',
      resourceId: claimReference,
      tenantId: this.tenantId(),
      retryFailed: false,
      run: async () => {
        const claim = await this.requireClaim(claimReference);
        if (input.outcome === 'applied' || input.outcome === 'not_applied') {
          const outcome = input.outcome;
          await storage.transaction((repositories) =>
            resolveSubscriptionMutationClaim(
              repositories,
              claim,
              outcome,
              input.evidenceReference,
              this.dependencies.clock.now(),
            ),
          );
        } else {
          await storage.transaction((repositories) =>
            observeSubscriptionMutationClaim(
              repositories,
              claim,
              input.evidenceReference,
              this.dependencies.clock.now(),
            ),
          );
        }
        return { claimReference };
      },
      revive: reviveClaimReference,
    });
    return this.retrieve(reference.claimReference);
  }

  private async requireClaim(claimReference: string): Promise<SubscriptionMutationClaim> {
    const claim = await this.repository().findByReference(claimReference, this.tenantId());
    if (!claim) throw claimConflict(claimReference);
    return claim;
  }

  private repository() {
    const repository = this.dependencies.storage?.subscriptionMutationClaims;
    if (!repository) throw claimConflict('missing-storage');
    return repository;
  }

  private tenantId(): string | null {
    return this.dependencies.tenantId ?? null;
  }
}

function toView(claim: SubscriptionMutationClaim): SubscriptionMutationClaimView {
  const {
    claimReference,
    tenantId,
    subscriptionId,
    operation,
    correlationId,
    status,
    resolutionOutcome,
    resolutionEvidenceReference,
    resolvedAt,
    observationOutcome,
    observationEvidenceReference,
    observedAt,
    claimedAt,
  } = claim;
  return {
    claimReference,
    tenantId,
    subscriptionId,
    operation,
    correlationId,
    status,
    resolutionOutcome,
    resolutionEvidenceReference,
    resolvedAt,
    observationOutcome,
    observationEvidenceReference,
    observedAt,
    claimedAt,
  };
}

function assertResolutionInput(input: ResolveSubscriptionMutationClaimInput): void {
  if (
    !['applied', 'not_applied', 'unknown'].includes(input.outcome) ||
    input.evidenceReference.length === 0 ||
    input.evidenceReference.length > 512 ||
    input.evidenceReference.trim() !== input.evidenceReference
  ) {
    throw new TypeError('A direct mutation outcome and evidence reference are required');
  }
}

function reviveClaimReference(value: unknown): { claimReference: string } {
  const claimReference = (value as { claimReference?: unknown } | null)?.claimReference;
  if (typeof claimReference !== 'string' || claimReference.length === 0) {
    throw claimConflict('stale-reference');
  }
  return { claimReference };
}
