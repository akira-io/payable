import type { TenantScoped, Timestamps } from './common';

export interface PriceProviderBinding extends TenantScoped, Timestamps {
  readonly id: string;
  readonly priceId: string;
  readonly provider: string;
  readonly providerPriceId: string;
}
