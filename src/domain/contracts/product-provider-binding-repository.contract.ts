import type { ProductProviderBinding } from '../entities/product-provider-binding.entity';

export type NewProductProviderBinding = Omit<
  ProductProviderBinding,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface ProductProviderBindingRepository {
  create(binding: NewProductProviderBinding): Promise<ProductProviderBinding>;
  updateProviderId?(id: string, providerProductId: string): Promise<ProductProviderBinding>;
  findByProductAndProvider(
    productId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null>;
  findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null>;
  listByProductId(productId: string, tenantId: string | null): Promise<ProductProviderBinding[]>;
  listByProductIds?(
    productIds: string[],
    tenantId: string | null,
  ): Promise<ProductProviderBinding[]>;
}
