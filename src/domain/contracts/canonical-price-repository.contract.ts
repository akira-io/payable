import type { CanonicalPrice } from '../entities/canonical-price.entity';
import type { ListCursor } from './list-options.contract';

export type NewCanonicalPrice = Omit<CanonicalPrice, 'id' | 'createdAt' | 'updatedAt'>;
export type CanonicalPricePatch = Pick<CanonicalPrice, 'active' | 'description' | 'lookupKey'>;

export interface CanonicalPriceListQuery {
  limit: number;
  before?: ListCursor;
  active?: boolean;
  productId?: string;
  type?: CanonicalPrice['type'];
  lookupKeys?: string[];
}

export interface CanonicalPriceListResult {
  items: CanonicalPrice[];
  hasMore: boolean;
}

export interface CanonicalPriceRepository {
  create(price: NewCanonicalPrice): Promise<CanonicalPrice>;
  update(
    id: string,
    patch: Partial<CanonicalPricePatch>,
    tenantId: string | null,
  ): Promise<CanonicalPrice>;
  findById(id: string, tenantId: string | null): Promise<CanonicalPrice | null>;
  findByLookupKey(lookupKey: string, tenantId: string | null): Promise<CanonicalPrice | null>;
  list(query: CanonicalPriceListQuery, tenantId: string | null): Promise<CanonicalPriceListResult>;
}
