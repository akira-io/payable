import type { SubscriptionChangeItem } from '../../../domain/dtos/subscription-change.dto';

export type SubscriptionChangeOperation = 'changePrice' | 'changeQuantity';

export function subscriptionChangeOperation(
  currentItems: readonly Pick<SubscriptionChangeItem, 'itemId' | 'priceId'>[],
  proposedItems: readonly Pick<SubscriptionChangeItem, 'itemId' | 'priceId'>[],
): SubscriptionChangeOperation {
  const currentById = new Map(currentItems.map((item) => [item.itemId, item]));
  return proposedItems.some(
    (proposed) => currentById.get(proposed.itemId)?.priceId !== proposed.priceId,
  )
    ? 'changePrice'
    : 'changeQuantity';
}
