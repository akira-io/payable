import type { CanonicalPrice } from '../../../domain/entities/canonical-price.entity';
import type {
  SubscriptionPriceMigrationItemSnapshot,
  SubscriptionPriceSnapshot,
} from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';

export function priceMigrationPriceSnapshot(price: CanonicalPrice): SubscriptionPriceSnapshot {
  return {
    id: price.id,
    productId: price.productId,
    amount: price.unitAmount,
    currency: price.currency,
    interval: price.interval,
    intervalCount: price.intervalCount,
  };
}

export function priceMigrationItemSnapshot(item: {
  id: string;
  priceId: string;
  quantity: number;
}): SubscriptionPriceMigrationItemSnapshot {
  return { id: item.id, priceId: item.priceId, quantity: item.quantity };
}

export function reviveSubscriptionPriceMigrationReference(value: unknown): {
  migrationId: string;
} {
  const migrationId = (value as { migrationId?: unknown } | null)?.migrationId;
  if (typeof migrationId !== 'string' || migrationId.length === 0) {
    throw new SubscriptionPriceMigrationError(
      'Stored subscription migration preview reference is invalid',
      'SUBSCRIPTION_MIGRATION_PREVIEW_STALE',
    );
  }
  return { migrationId };
}
