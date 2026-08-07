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
      effectiveTimings: ['nextRenewal'],
    },
    cancel: { immediately: true, atPeriodEnd: false },
  });
}
