import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import { isSubscriptionOperationCapabilitiesProvider } from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type { SubscriptionOperationCapabilities } from '../../../domain/dtos/subscription-operation-capabilities.dto';
import type {
  PausePaymentCollectionPolicy,
  PauseSubscriptionPolicy,
  ResumePausedSubscriptionPolicy,
} from '../../../domain/dtos/subscription-pause-policy.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';

export type SubscriptionOperation =
  | 'createCheckout'
  | 'createDirect'
  | 'changePrice'
  | 'changeQuantity'
  | 'cancelImmediately'
  | 'cancelAtPeriodEnd'
  | 'pause'
  | 'resumePaused'
  | 'resume'
  | 'pausePaymentCollection'
  | 'resumePaymentCollection'
  | 'cancelScheduledChange';

const SUBSCRIPTION_OPERATION_CAPABILITY_NAMES: Record<SubscriptionOperation, string> = {
  createCheckout: 'subscriptions.create.checkout',
  createDirect: 'subscriptions.create.direct',
  changePrice: 'subscriptions.change-price',
  changeQuantity: 'subscriptions.change-quantity',
  cancelImmediately: 'subscriptions.cancel.immediately',
  cancelAtPeriodEnd: 'subscriptions.cancel.at-period-end',
  pause: 'subscriptions.pause',
  resumePaused: 'subscriptions.resume.paused-subscription',
  resume: 'subscriptions.resume',
  pausePaymentCollection: 'subscriptions.pause.payment-collection',
  resumePaymentCollection: 'subscriptions.resume.payment-collection',
  cancelScheduledChange: 'subscriptions.scheduled-change.cancel',
};

export function assertSubscriptionOperation(
  provider: PaymentProvider,
  operation: SubscriptionOperation,
): void {
  if (!isSubscriptionOperationCapabilitiesProvider(provider)) {
    if (
      operation === 'pause' ||
      operation === 'resumePaused' ||
      operation === 'pausePaymentCollection' ||
      operation === 'resumePaymentCollection' ||
      operation === 'cancelScheduledChange'
    ) {
      throw new ProviderCapabilityNotSupportedError(
        provider.name,
        SUBSCRIPTION_OPERATION_CAPABILITY_NAMES[operation],
      );
    }
    return;
  }
  const capabilities = provider.subscriptionOperationCapabilities();
  if (!isSubscriptionOperationSupported(capabilities, operation)) {
    throw new ProviderCapabilityNotSupportedError(
      provider.name,
      SUBSCRIPTION_OPERATION_CAPABILITY_NAMES[operation],
    );
  }
}

function isSubscriptionOperationSupported(
  capabilities: SubscriptionOperationCapabilities,
  operation: SubscriptionOperation,
): boolean {
  switch (operation) {
    case 'createCheckout':
      return capabilities.create.checkout;
    case 'createDirect':
      return capabilities.create.direct;
    case 'changePrice':
      return capabilities.changePrice.effectiveTimings.length > 0;
    case 'changeQuantity':
      return capabilities.changeQuantity.effectiveTimings.length > 0;
    case 'cancelImmediately':
      return capabilities.cancel.immediately;
    case 'cancelAtPeriodEnd':
      return capabilities.cancel.atPeriodEnd;
    case 'pause':
      return capabilities.pause.subscription.effectiveTimings.length > 0;
    case 'resume':
      return capabilities.resume.pendingCancellation;
    case 'resumePaused':
      return capabilities.resume.pausedSubscription.effectiveTimings.length > 0;
    case 'pausePaymentCollection':
      return capabilities.pause.paymentCollection.behaviors.length > 0;
    case 'resumePaymentCollection':
      return capabilities.resume.paymentCollection;
    case 'cancelScheduledChange':
      return capabilities.scheduledChange.cancel;
  }
}

function unsupported(provider: PaymentProvider, capability: string): never {
  throw new ProviderCapabilityNotSupportedError(provider.name, capability);
}

export function assertPauseSubscriptionPolicySupported(
  provider: PaymentProvider,
  policy: PauseSubscriptionPolicy,
): void {
  assertSubscriptionOperation(provider, 'pause');
  if (!isSubscriptionOperationCapabilitiesProvider(provider)) return;
  const capability = provider.subscriptionOperationCapabilities().pause.subscription;
  if (!capability.effectiveTimings.includes(policy.effectiveTiming)) {
    unsupported(provider, `subscriptions.pause.${policy.effectiveTiming}`);
  }
  if (!capability.resumeBillingPolicies.includes(policy.resumeBillingPolicy)) {
    unsupported(provider, `subscriptions.pause.${policy.resumeBillingPolicy}`);
  }
  if (policy.resumeAt && !capability.scheduledResume) {
    unsupported(provider, 'subscriptions.pause.scheduled-resume');
  }
}

export function assertResumePausedSubscriptionPolicySupported(
  provider: PaymentProvider,
  policy: ResumePausedSubscriptionPolicy,
): void {
  assertSubscriptionOperation(provider, 'resumePaused');
  if (!isSubscriptionOperationCapabilitiesProvider(provider)) return;
  const capability = provider.subscriptionOperationCapabilities().resume.pausedSubscription;
  if (!capability.effectiveTimings.includes(policy.effectiveTiming)) {
    unsupported(provider, `subscriptions.resume.${policy.effectiveTiming}`);
  }
  if (!capability.billingPolicies.includes(policy.billingPolicy)) {
    unsupported(provider, `subscriptions.resume.${policy.billingPolicy}`);
  }
}

export function assertPausePaymentCollectionPolicySupported(
  provider: PaymentProvider,
  policy: PausePaymentCollectionPolicy,
): void {
  assertSubscriptionOperation(provider, 'pausePaymentCollection');
  if (!isSubscriptionOperationCapabilitiesProvider(provider)) return;
  const capability = provider.subscriptionOperationCapabilities().pause.paymentCollection;
  if (!capability.behaviors.includes(policy.behavior)) {
    unsupported(provider, `subscriptions.pause.payment-collection.${policy.behavior}`);
  }
  if (policy.resumesAt && !capability.scheduledResume) {
    unsupported(provider, 'subscriptions.pause.payment-collection.scheduled-resume');
  }
}
