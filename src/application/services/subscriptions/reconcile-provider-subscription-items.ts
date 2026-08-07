import type { SubscriptionProviderItemDTO } from '../../../domain/dtos/subscription.dto';
import type { SubscriptionItem } from '../../../domain/entities/subscription-item.entity';

export interface SubscriptionItemReconciliation {
  itemId: string;
  providerItemId: string | null;
  priceId: string;
  quantity: number;
}

export function reconcileProviderSubscriptionItems(
  localItems: readonly SubscriptionItem[],
  providerItems: readonly SubscriptionProviderItemDTO[],
): SubscriptionItemReconciliation[] {
  const unmatchedLocalItemIds = new Set(localItems.map((localItem) => localItem.id));
  return providerItems.flatMap((providerItem) => {
    const stableMatch = providerItem.providerItemId
      ? localItems.find((localItem) => localItem.providerItemId === providerItem.providerItemId)
      : undefined;
    const priceMatches = localItems.filter(
      (localItem) =>
        unmatchedLocalItemIds.has(localItem.id) &&
        localItem.providerItemId === null &&
        localItem.priceId === providerItem.priceId,
    );
    const localItem = stableMatch ?? (priceMatches.length === 1 ? priceMatches[0] : undefined);
    if (!localItem || !unmatchedLocalItemIds.has(localItem.id)) {
      return [];
    }
    unmatchedLocalItemIds.delete(localItem.id);
    return [
      {
        itemId: localItem.id,
        providerItemId: providerItem.providerItemId,
        priceId: providerItem.priceId,
        quantity: providerItem.quantity,
      },
    ];
  });
}
