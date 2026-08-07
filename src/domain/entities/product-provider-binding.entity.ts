import type { TenantScoped, Timestamps } from './common';

export interface ProductProviderBinding extends TenantScoped, Timestamps {
  readonly id: string;
  readonly productId: string;
  readonly provider: string;
  readonly providerProductId: string;
}
