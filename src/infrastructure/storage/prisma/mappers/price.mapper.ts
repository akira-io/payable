import type { NewPrice } from '../../../../domain/contracts/price-repository.contract';
import type { RecurringInterval } from '../../../../domain/entities/common';
import type { Price } from '../../../../domain/entities/price.entity';
import { CurrencyManager } from '../../../../domain/value-objects/currency';
import type { PrismaPriceRow } from '../prisma-client.types';
import { fromMinor, toMinor } from './shared';

export function priceToEntity(row: PrismaPriceRow): Price {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    provider: row.provider,
    providerPriceId: row.providerPriceId ?? null,
    productId: row.productId,
    currency: CurrencyManager.normalize(row.currency),
    unitAmount: toMinor(row.unitAmount, 'unit_amount'),
    interval: (row.interval as RecurringInterval | null) ?? null,
    intervalCount: row.intervalCount ?? null,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function priceToRow(data: Partial<NewPrice>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    provider: data.provider,
    providerPriceId: data.providerPriceId,
    productId: data.productId,
    currency: data.currency,
    unitAmount: fromMinor(data.unitAmount),
    interval: data.interval,
    intervalCount: data.intervalCount,
    active: data.active,
  };
}
