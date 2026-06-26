import type { Product } from '../entities/product.entity';

export type NewProduct = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

export interface ProductRepository {
  create(data: NewProduct): Promise<Product>;
  update(id: string, patch: Partial<NewProduct>): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId?: string | null,
  ): Promise<Product | null>;
}
