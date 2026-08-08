import type { PriceProviderBinding } from '../entities/price-provider-binding.entity';

export type NewPriceProviderBinding = Omit<PriceProviderBinding, 'id' | 'createdAt' | 'updatedAt'>;

export interface PriceProviderBindingRepository {
  create(binding: NewPriceProviderBinding): Promise<PriceProviderBinding>;
  updateProviderId?(id: string, providerPriceId: string): Promise<PriceProviderBinding>;
  findByPriceAndProvider(
    priceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null>;
  findByProviderId(
    provider: string,
    providerPriceId: string,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null>;
  listByPriceId(priceId: string, tenantId: string | null): Promise<PriceProviderBinding[]>;
  listByPriceIds?(priceIds: string[], tenantId: string | null): Promise<PriceProviderBinding[]>;
}
