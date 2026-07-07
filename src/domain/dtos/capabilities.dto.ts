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
  | 'catalog';

export type ProviderCapabilityValue = ProviderCapability | (string & {});

export type ProviderCapabilities = ReadonlySet<ProviderCapabilityValue>;
