import {
  defineSubscriptionOperationCapabilities,
  NO_SUBSCRIPTION_OPERATIONS,
} from '../../../domain/dtos/subscription-operation-capabilities.dto';

export function revolutSubscriptionOperationCapabilities() {
  return defineSubscriptionOperationCapabilities({
    ...NO_SUBSCRIPTION_OPERATIONS,
    create: { checkout: true, direct: true },
    changePrice: {
      ...NO_SUBSCRIPTION_OPERATIONS.changePrice,
      preview: true,
      effectiveTimings: ['nextRenewal'],
      prorationPolicies: ['none'],
      paymentFailurePolicies: ['applyChange'],
    },
    cancel: { immediately: true, atPeriodEnd: false },
  });
}
