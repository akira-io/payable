import type { SubscriptionMutationOperation } from '../../domain/contracts/subscription-mutation-claim-repository.contract';

export interface SubscriptionMutationClaimView {
  readonly claimReference: string;
  readonly tenantId: string | null;
  readonly subscriptionId: string;
  readonly operation: SubscriptionMutationOperation;
  readonly correlationId: string;
  readonly status: 'active' | 'resolved';
  readonly resolutionOutcome: 'applied' | 'not_applied' | null;
  readonly resolutionEvidenceReference: string | null;
  readonly resolvedAt: Date | null;
  readonly observationOutcome: 'unknown' | null;
  readonly observationEvidenceReference: string | null;
  readonly observedAt: Date | null;
  readonly claimedAt: Date;
}

export interface ResolveSubscriptionMutationClaimInput {
  readonly idempotencyKey: string;
  readonly outcome: 'applied' | 'not_applied' | 'unknown';
  readonly evidenceReference: string;
}

export interface SubscriptionMutationClaimResource {
  retrieve(claimReference: string): Promise<SubscriptionMutationClaimView>;
  resolve(
    claimReference: string,
    input: ResolveSubscriptionMutationClaimInput,
  ): Promise<SubscriptionMutationClaimView>;
}
