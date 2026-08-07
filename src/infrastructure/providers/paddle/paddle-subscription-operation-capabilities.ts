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
    resume: {
      ...NO_SUBSCRIPTION_OPERATIONS.resume,
      pausedSubscription: true,
      billingPolicies: ['startNewBillingPeriod'],
    },
  });
}
