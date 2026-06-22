export interface ProviderCapabilities {
  checkout: boolean;
  subscriptions: boolean;
  trials: boolean;
  refunds: boolean;
  coupons: boolean;
  billingPortal: boolean;
  meteredBilling: boolean;
  invoicePdf: boolean;
}

export type ProviderCapability = keyof ProviderCapabilities;
