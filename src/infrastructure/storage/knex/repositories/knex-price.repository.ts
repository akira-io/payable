import type {
  NewPrice,
  PriceRepository,
} from '../../../../domain/contracts/price-repository.contract';
import type { RecurringInterval } from '../../../../domain/entities/common';
import type { Price } from '../../../../domain/entities/price.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import { KnexRepository } from '../knex-repository';
import { toBool, toDate } from '../mappers';

export class KnexPriceRepository
  extends KnexRepository<Price, NewPrice>
  implements PriceRepository
{
  protected readonly table = 'payable_prices';

  findByProviderId(provider: string, providerPriceId: string): Promise<Price | null> {
    return this.firstWhere({ provider, provider_price_id: providerPriceId });
  }

  listByProduct(productId: string): Promise<Price[]> {
    return this.manyWhere({ product_id: productId });
  }

  protected toEntity(row: Record<string, unknown>): Price {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      provider: row.provider as string,
      providerPriceId: (row.provider_price_id as string | null) ?? null,
      productId: row.product_id as string,
      currency: CurrencyManager.normalize(row.currency as string),
      unitAmount: row.unit_amount as number,
      interval: (row.interval as RecurringInterval | null) ?? null,
      intervalCount: (row.interval_count as number | null) ?? null,
      active: toBool(row.active),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewPrice>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      provider: data.provider,
      provider_price_id: data.providerPriceId,
      product_id: data.productId,
      currency: data.currency,
      unit_amount: data.unitAmount,
      interval: data.interval,
      interval_count: data.intervalCount,
      active: data.active,
    };
  }
}
