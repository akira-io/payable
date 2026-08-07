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

export type SubscriptionPaymentCollectionBehavior = 'keepAsDraft' | 'markUncollectible' | 'void';

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
    subscription: Readonly<{
      effectiveTimings: readonly SubscriptionEffectiveTiming[];
      scheduledResume: boolean;
      resumeBillingPolicies: readonly SubscriptionResumeBillingPolicy[];
    }>;
    paymentCollection: Readonly<{
      behaviors: readonly SubscriptionPaymentCollectionBehavior[];
      scheduledResume: boolean;
    }>;
  }>;
  readonly resume: Readonly<{
    pendingCancellation: boolean;
    pausedSubscription: Readonly<{
      effectiveTimings: readonly SubscriptionEffectiveTiming[];
      billingPolicies: readonly SubscriptionResumeBillingPolicy[];
    }>;
    paymentCollection: boolean;
  }>;
  readonly scheduledChange: Readonly<{ cancel: boolean }>;
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
      subscription: Object.freeze({
        effectiveTimings: Object.freeze([...capabilities.pause.subscription.effectiveTimings]),
        scheduledResume: capabilities.pause.subscription.scheduledResume,
        resumeBillingPolicies: Object.freeze([
          ...capabilities.pause.subscription.resumeBillingPolicies,
        ]),
      }),
      paymentCollection: Object.freeze({
        behaviors: Object.freeze([...capabilities.pause.paymentCollection.behaviors]),
        scheduledResume: capabilities.pause.paymentCollection.scheduledResume,
      }),
    }),
    resume: Object.freeze({
      pendingCancellation: capabilities.resume.pendingCancellation,
      pausedSubscription: Object.freeze({
        effectiveTimings: Object.freeze([
          ...capabilities.resume.pausedSubscription.effectiveTimings,
        ]),
        billingPolicies: Object.freeze([...capabilities.resume.pausedSubscription.billingPolicies]),
      }),
      paymentCollection: capabilities.resume.paymentCollection,
    }),
    scheduledChange: Object.freeze({ ...capabilities.scheduledChange }),
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
  pause: {
    subscription: { effectiveTimings: [], scheduledResume: false, resumeBillingPolicies: [] },
    paymentCollection: { behaviors: [], scheduledResume: false },
  },
  resume: {
    pendingCancellation: false,
    pausedSubscription: { effectiveTimings: [], billingPolicies: [] },
    paymentCollection: false,
  },
  scheduledChange: { cancel: false },
});
