import {
  defineSubscriptionOperationCapabilities,
  NO_SUBSCRIPTION_OPERATIONS,
} from '../../../domain/dtos/subscription-operation-capabilities.dto';

export function stripeSubscriptionOperationCapabilities() {
  return defineSubscriptionOperationCapabilities({
    ...NO_SUBSCRIPTION_OPERATIONS,
    itemIdentity: 'stable',
    create: { checkout: true, direct: true },
    changePrice: {
      preview: false,
      effectiveTimings: ['immediate'],
      prorationPolicies: ['prorateAtNextRenewal'],
      paymentFailurePolicies: ['applyChange'],
    },
    changeQuantity: {
      preview: false,
      effectiveTimings: ['immediate'],
      prorationPolicies: ['prorateAtNextRenewal'],
      paymentFailurePolicies: ['applyChange'],
    },
    cancel: { immediately: true, atPeriodEnd: true },
    resume: {
      ...NO_SUBSCRIPTION_OPERATIONS.resume,
      pendingCancellation: true,
    },
  });
}
