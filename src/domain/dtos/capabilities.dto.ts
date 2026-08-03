export type ProviderCapability =
  | 'checkout'
  | 'charges'
  | 'subscriptions'
  | 'trials'
  | 'refunds'
  | 'coupons'
  | 'billingPortal'
  | 'meteredBilling'
  | 'invoicePdf'
  | 'webhooks'
  | 'customers'
  | 'paymentMethods'
  | 'paymentMethodSetup'
  | 'disputes'
  | 'payouts'
  | 'webhookEndpointManagement'
  | 'catalog'
  | 'catalogRead'
  | 'catalogLifecycle'
  | 'catalogIdempotency'
  | 'priceLookupKeys';

export type ProviderCapabilityValue = ProviderCapability | (string & {});

export type ProviderCapabilities = ReadonlySet<ProviderCapabilityValue>;
