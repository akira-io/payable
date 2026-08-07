export type SubscriptionEffectiveTiming = 'immediate' | 'nextRenewal' | 'scheduled';

export type SubscriptionProrationPolicy =
  | 'prorateImmediately'
  | 'prorateAtNextRenewal'
  | 'chargeFullImmediately'
  | 'chargeFullAtNextRenewal'
  | 'none';

export type SubscriptionPaymentFailurePolicy = 'preventChange' | 'applyChange';

export type SubscriptionItemIdentity = 'stable' | 'price' | 'none';

export type SubscriptionResumeBillingPolicy =
  | 'startNewBillingPeriod'
  | 'continueExistingBillingPeriod';

export interface SubscriptionChangeCapabilities {
  readonly preview: boolean;
  readonly effectiveTimings: readonly SubscriptionEffectiveTiming[];
  readonly prorationPolicies: readonly SubscriptionProrationPolicy[];
  readonly paymentFailurePolicies: readonly SubscriptionPaymentFailurePolicy[];
}

export interface SubscriptionOperationCapabilities {
  readonly itemIdentity: SubscriptionItemIdentity;
  readonly create: Readonly<{ checkout: boolean; direct: boolean }>;
  readonly changePrice: SubscriptionChangeCapabilities;
  readonly changeQuantity: SubscriptionChangeCapabilities;
  readonly cancel: Readonly<{ immediately: boolean; atPeriodEnd: boolean }>;
  readonly pause: Readonly<{
    effectiveTimings: readonly SubscriptionEffectiveTiming[];
    scheduledResume: boolean;
    resumeBillingPolicies: readonly SubscriptionResumeBillingPolicy[];
  }>;
  readonly resume: Readonly<{
    pendingCancellation: boolean;
    pausedSubscription: boolean;
    scheduled: boolean;
    billingPolicies: readonly SubscriptionResumeBillingPolicy[];
  }>;
}

type SubscriptionOperationCapabilitiesInput = Omit<
  SubscriptionOperationCapabilities,
  'itemIdentity'
> & {
  readonly itemIdentity?: SubscriptionItemIdentity;
};

function freezeChangeCapabilities(
  capabilities: SubscriptionChangeCapabilities,
): SubscriptionChangeCapabilities {
  return Object.freeze({
    preview: capabilities.preview,
    effectiveTimings: Object.freeze([...capabilities.effectiveTimings]),
    prorationPolicies: Object.freeze([...capabilities.prorationPolicies]),
    paymentFailurePolicies: Object.freeze([...capabilities.paymentFailurePolicies]),
  });
}

export function defineSubscriptionOperationCapabilities(
  capabilities: SubscriptionOperationCapabilitiesInput,
): SubscriptionOperationCapabilities {
  return Object.freeze({
    itemIdentity: capabilities.itemIdentity ?? 'none',
    create: Object.freeze({ ...capabilities.create }),
    changePrice: freezeChangeCapabilities(capabilities.changePrice),
    changeQuantity: freezeChangeCapabilities(capabilities.changeQuantity),
    cancel: Object.freeze({ ...capabilities.cancel }),
    pause: Object.freeze({
      effectiveTimings: Object.freeze([...capabilities.pause.effectiveTimings]),
      scheduledResume: capabilities.pause.scheduledResume,
      resumeBillingPolicies: Object.freeze([...capabilities.pause.resumeBillingPolicies]),
    }),
    resume: Object.freeze({
      pendingCancellation: capabilities.resume.pendingCancellation,
      pausedSubscription: capabilities.resume.pausedSubscription,
      scheduled: capabilities.resume.scheduled,
      billingPolicies: Object.freeze([...capabilities.resume.billingPolicies]),
    }),
  });
}

export const NO_SUBSCRIPTION_OPERATIONS = defineSubscriptionOperationCapabilities({
  itemIdentity: 'none',
  create: { checkout: false, direct: false },
  changePrice: {
    preview: false,
    effectiveTimings: [],
    prorationPolicies: [],
    paymentFailurePolicies: [],
  },
  changeQuantity: {
    preview: false,
    effectiveTimings: [],
    prorationPolicies: [],
    paymentFailurePolicies: [],
  },
  cancel: { immediately: false, atPeriodEnd: false },
  pause: { effectiveTimings: [], scheduledResume: false, resumeBillingPolicies: [] },
  resume: {
    pendingCancellation: false,
    pausedSubscription: false,
    scheduled: false,
    billingPolicies: [],
  },
});
