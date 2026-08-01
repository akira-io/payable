import type { Product } from '../entities/product.entity';

export type NewProduct = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;
export type ProductPatch = Partial<Omit<NewProduct, 'tenantId'>>;

export interface ProductRepository {
  create(data: NewProduct): Promise<Product>;
  update(id: string, patch: ProductPatch, tenantId: string | null): Promise<Product>;
  findById(id: string, tenantId: string | null): Promise<Product | null>;
  findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId: string | null,
  ): Promise<Product | null>;
}
