import type { Price } from '../entities/price.entity';

export type NewPrice = Omit<Price, 'id' | 'createdAt' | 'updatedAt'>;
export type PricePatch = Partial<Omit<NewPrice, 'tenantId'>>;

export interface PriceRepository {
  create(data: NewPrice): Promise<Price>;
  update(id: string, patch: PricePatch, tenantId: string | null): Promise<Price>;
  updateIfUnchanged(
    id: string,
    expected: Price,
    patch: PricePatch,
    tenantId: string | null,
  ): Promise<Price | null>;
  findById(id: string, tenantId: string | null): Promise<Price | null>;
  findByProviderId(
    provider: string,
    providerPriceId: string,
    tenantId: string | null,
  ): Promise<Price | null>;
  listByProduct(productId: string, tenantId: string | null): Promise<Price[]>;
}
