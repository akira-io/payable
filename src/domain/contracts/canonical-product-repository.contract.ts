import type { CanonicalProduct } from '../entities/canonical-product.entity';
import type { ListCursor } from './list-options.contract';

export type NewCanonicalProduct = Omit<CanonicalProduct, 'id' | 'createdAt' | 'updatedAt'>;
export type CanonicalProductPatch = Partial<Omit<NewCanonicalProduct, 'tenantId'>>;

export interface CanonicalProductListQuery {
  limit: number;
  before?: ListCursor;
  active?: boolean;
}

export interface CanonicalProductListResult {
  items: CanonicalProduct[];
  hasMore: boolean;
}

export interface CanonicalProductRepository {
  create(product: NewCanonicalProduct): Promise<CanonicalProduct>;
  update(
    id: string,
    patch: CanonicalProductPatch,
    tenantId: string | null,
  ): Promise<CanonicalProduct>;
  findById(id: string, tenantId: string | null): Promise<CanonicalProduct | null>;
  list(
    query: CanonicalProductListQuery,
    tenantId: string | null,
  ): Promise<CanonicalProductListResult>;
}
