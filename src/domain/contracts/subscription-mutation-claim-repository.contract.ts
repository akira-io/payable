export type SubscriptionMutationOperation =
  | 'subscription_price_migration'
  | 'subscription_swap'
  | 'subscription_quantity_update'
  | 'subscription_cancel'
  | 'subscription_cancel_now'
  | 'subscription_cancel_scheduled_change'
  | 'subscription_pause'
  | 'subscription_pause_payment_collection'
  | 'subscription_resume'
  | 'subscription_resume_paused'
  | 'subscription_resume_payment_collection'
  | 'subscription_change_apply';

declare const subscriptionMutationIntentBlob: unique symbol;

export type SubscriptionMutationIntentBlob = string & {
  readonly [subscriptionMutationIntentBlob]: true;
};

const SUBSCRIPTION_MUTATION_INTENT_PREFIX = 'payable:subscription-mutation-intent:v1:';

export function rehydrateSubscriptionMutationIntentBlob(
  value: string,
): SubscriptionMutationIntentBlob {
  if (
    !value.startsWith(SUBSCRIPTION_MUTATION_INTENT_PREFIX) ||
    value.length === SUBSCRIPTION_MUTATION_INTENT_PREFIX.length
  ) {
    throw new TypeError('Subscription mutation intent has an unsupported version');
  }
  return value as SubscriptionMutationIntentBlob;
}

export interface SubscriptionMutationClaim {
  readonly claimReference: string;
  readonly tenantId: string | null;
  readonly subscriptionId: string;
  readonly ownerToken: string;
  readonly operation: SubscriptionMutationOperation;
  readonly correlationId: string;
  readonly intent: SubscriptionMutationIntentBlob | null;
  readonly status: 'active' | 'resolved';
  readonly resolutionOutcome: 'applied' | 'not_applied' | null;
  readonly resolutionEvidenceReference: string | null;
  readonly resolvedAt: Date | null;
  readonly observationOutcome: 'unknown' | null;
  readonly observationEvidenceReference: string | null;
  readonly observedAt: Date | null;
  readonly claimedAt: Date;
}

export interface AcquireSubscriptionMutationClaim {
  readonly claimReference: string;
  readonly tenantId: string | null;
  readonly subscriptionId: string;
  readonly ownerToken: string;
  readonly operation: SubscriptionMutationOperation;
  readonly correlationId: string;
  readonly intent: SubscriptionMutationIntentBlob | null;
  readonly claimedAt: Date;
}

export interface ObserveSubscriptionMutationClaim {
  readonly claimReference: string;
  readonly tenantId: string | null;
  readonly expectedOwnerToken: string;
  readonly outcome: 'unknown';
  readonly evidenceReference: string;
  readonly observedAt: Date;
}

export interface ResolveSubscriptionMutationClaim {
  readonly claimReference: string;
  readonly tenantId: string | null;
  readonly expectedOwnerToken: string;
  readonly outcome: 'applied' | 'not_applied';
  readonly evidenceReference: string;
  readonly resolvedAt: Date;
}

export interface ReleaseSubscriptionMutationClaim {
  readonly tenantId: string | null;
  readonly subscriptionId: string;
  readonly ownerToken: string;
}

export interface SubscriptionMutationClaimRepository {
  acquire(input: AcquireSubscriptionMutationClaim): Promise<boolean>;
  release(input: ReleaseSubscriptionMutationClaim): Promise<boolean>;
  findByReference(
    claimReference: string,
    tenantId: string | null,
  ): Promise<SubscriptionMutationClaim | null>;
  findActiveBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionMutationClaim | null>;
  observe(input: ObserveSubscriptionMutationClaim): Promise<SubscriptionMutationClaim | null>;
  resolve(input: ResolveSubscriptionMutationClaim): Promise<SubscriptionMutationClaim | null>;
}
