import type { Price } from '../entities/price.entity';

export type NewPrice = Omit<Price, 'id' | 'createdAt' | 'updatedAt'>;

export interface PriceRepository {
  create(data: NewPrice): Promise<Price>;
  update(id: string, patch: Partial<NewPrice>): Promise<Price>;
  findById(id: string): Promise<Price | null>;
  findByProviderId(provider: string, providerPriceId: string): Promise<Price | null>;
  listByProduct(productId: string): Promise<Price[]>;
}
