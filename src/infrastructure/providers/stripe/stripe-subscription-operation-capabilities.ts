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
      preview: true,
      effectiveTimings: ['immediate'],
      prorationPolicies: ['prorateImmediately', 'prorateAtNextRenewal', 'none'],
      paymentFailurePolicies: ['preventChange', 'applyChange'],
    },
    changeQuantity: {
      preview: true,
      effectiveTimings: ['immediate'],
      prorationPolicies: ['prorateImmediately', 'prorateAtNextRenewal', 'none'],
      paymentFailurePolicies: ['preventChange', 'applyChange'],
    },
    cancel: { immediately: true, atPeriodEnd: true },
    pause: {
      ...NO_SUBSCRIPTION_OPERATIONS.pause,
      paymentCollection: {
        behaviors: ['keepAsDraft', 'markUncollectible', 'void'],
        scheduledResume: true,
      },
    },
    resume: {
      ...NO_SUBSCRIPTION_OPERATIONS.resume,
      pendingCancellation: true,
      paymentCollection: true,
    },
  });
}
