import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';

export function revolutCapabilities(): ProviderCapabilities {
  return new Set([
    'checkout',
    'refunds',
    'webhooks',
    'customers',
    'paymentMethods',
    'paymentMethodSetup',
    'disputes',
    'payouts',
    'webhookEndpointManagement',
    'subscriptions',
  ]);
}
