import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import { isSubscriptionOperationCapabilitiesProvider } from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type { SubscriptionOperationCapabilities } from '../../../domain/dtos/subscription-operation-capabilities.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';

export type SubscriptionOperation =
  | 'createCheckout'
  | 'createDirect'
  | 'changePrice'
  | 'changeQuantity'
  | 'cancelImmediately'
  | 'cancelAtPeriodEnd'
  | 'pause'
  | 'resume';

const SUBSCRIPTION_OPERATION_CAPABILITY_NAMES: Record<SubscriptionOperation, string> = {
  createCheckout: 'subscriptions.create.checkout',
  createDirect: 'subscriptions.create.direct',
  changePrice: 'subscriptions.change-price',
  changeQuantity: 'subscriptions.change-quantity',
  cancelImmediately: 'subscriptions.cancel.immediately',
  cancelAtPeriodEnd: 'subscriptions.cancel.at-period-end',
  pause: 'subscriptions.pause',
  resume: 'subscriptions.resume',
};

export function assertSubscriptionOperation(
  provider: PaymentProvider,
  operation: SubscriptionOperation,
): void {
  if (!isSubscriptionOperationCapabilitiesProvider(provider)) {
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
      return capabilities.pause.effectiveTimings.length > 0;
    case 'resume':
      return (
        capabilities.resume.pendingCancellation ||
        capabilities.resume.pausedSubscription ||
        capabilities.resume.scheduled
      );
  }
}
