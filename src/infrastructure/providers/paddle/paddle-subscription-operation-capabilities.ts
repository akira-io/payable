import {
  defineSubscriptionOperationCapabilities,
  NO_SUBSCRIPTION_OPERATIONS,
} from '../../../domain/dtos/subscription-operation-capabilities.dto';

export function paddleSubscriptionOperationCapabilities() {
  return defineSubscriptionOperationCapabilities({
    ...NO_SUBSCRIPTION_OPERATIONS,
    itemIdentity: 'price',
    create: { checkout: true, direct: false },
    changePrice: {
      preview: true,
      effectiveTimings: ['immediate'],
      prorationPolicies: [
        'prorateImmediately',
        'prorateAtNextRenewal',
        'chargeFullImmediately',
        'chargeFullAtNextRenewal',
        'none',
      ],
      paymentFailurePolicies: ['preventChange', 'applyChange'],
    },
    changeQuantity: {
      preview: true,
      effectiveTimings: ['immediate'],
      prorationPolicies: [
        'prorateImmediately',
        'prorateAtNextRenewal',
        'chargeFullImmediately',
        'chargeFullAtNextRenewal',
        'none',
      ],
      paymentFailurePolicies: ['preventChange', 'applyChange'],
    },
    cancel: { immediately: true, atPeriodEnd: true },
    pause: {
      ...NO_SUBSCRIPTION_OPERATIONS.pause,
      subscription: {
        effectiveTimings: ['immediate', 'nextRenewal'],
        scheduledResume: true,
        resumeBillingPolicies: ['startNewBillingPeriod', 'continueExistingBillingPeriod'],
      },
    },
    resume: {
      ...NO_SUBSCRIPTION_OPERATIONS.resume,
      pausedSubscription: {
        effectiveTimings: ['immediate', 'scheduled'],
        billingPolicies: ['startNewBillingPeriod', 'continueExistingBillingPeriod'],
      },
    },
    scheduledChange: { cancel: true },
  });
}
