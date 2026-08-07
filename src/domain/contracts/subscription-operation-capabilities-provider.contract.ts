import {
  defineSubscriptionOperationCapabilities,
  NO_SUBSCRIPTION_OPERATIONS,
  type SubscriptionOperationCapabilities,
} from '../dtos/subscription-operation-capabilities.dto';
import { isDirectSubscriptionCapable, type PaymentProvider } from './payment-provider.contract';

export interface SubscriptionOperationCapabilitiesProvider {
  subscriptionOperationCapabilities(): SubscriptionOperationCapabilities;
}

export function isSubscriptionOperationCapabilitiesProvider(
  provider: PaymentProvider,
): provider is PaymentProvider & SubscriptionOperationCapabilitiesProvider {
  return (
    typeof (provider as Partial<SubscriptionOperationCapabilitiesProvider>)
      .subscriptionOperationCapabilities === 'function'
  );
}

export function resolveSubscriptionOperationCapabilities(
  provider: PaymentProvider,
): SubscriptionOperationCapabilities {
  if (isSubscriptionOperationCapabilitiesProvider(provider)) {
    return defineSubscriptionOperationCapabilities(provider.subscriptionOperationCapabilities());
  }
  const subscriptions = provider.capabilities().has('subscriptions');
  return defineSubscriptionOperationCapabilities({
    ...NO_SUBSCRIPTION_OPERATIONS,
    create: {
      checkout: subscriptions,
      direct: subscriptions && isDirectSubscriptionCapable(provider),
    },
  });
}
