import type {
  SubscriptionLineItem,
  SubscriptionProviderItemDTO,
} from '../../../domain/dtos/subscription.dto';
import type { SubscriptionItem } from '../../../domain/entities/subscription-item.entity';
import { groupSubscriptionItems } from './match-provider-subscription-items';

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
  const unmatchedProviderItems = new Set(providerItems);
  const reconciliations: SubscriptionItemReconciliation[] = [];
  const reconcile = (
    localItem: SubscriptionItem,
    providerItem: SubscriptionProviderItemDTO,
  ): void => {
    unmatchedLocalItemIds.delete(localItem.id);
    unmatchedProviderItems.delete(providerItem);
    reconciliations.push({
      itemId: localItem.id,
      providerItemId: providerItem.providerItemId,
      priceId: providerItem.priceId,
      quantity: providerItem.quantity,
    });
  };

  for (const providerItem of providerItems) {
    const stableMatch = providerItem.providerItemId
      ? localItems.find((localItem) => localItem.providerItemId === providerItem.providerItemId)
      : undefined;
    if (stableMatch && unmatchedLocalItemIds.has(stableMatch.id)) {
      reconcile(stableMatch, providerItem);
    }
  }

  const matchGroups = (
    key: (subscriptionItem: SubscriptionLineItem) => string,
    duplicateGroupIsSafe: (localGroup: readonly SubscriptionItem[]) => boolean,
  ): void => {
    const localGroups = groupSubscriptionItems(
      localItems.filter(
        (localItem) => unmatchedLocalItemIds.has(localItem.id) && localItem.providerItemId === null,
      ),
      key,
    );
    for (const [groupKey, localGroup] of localGroups) {
      const providerGroup = [...unmatchedProviderItems].filter(
        (providerItem) => key(providerItem) === groupKey,
      );
      const safelyPairable =
        localGroup.length === providerGroup.length &&
        (localGroup.length === 1 ||
          (duplicateGroupIsSafe(localGroup) &&
            providerGroup.every((providerItem) => providerItem.providerItemId !== null)));
      if (!safelyPairable) {
        continue;
      }
      const sortedLocalGroup = localGroup.toSorted((left, right) =>
        left.id.localeCompare(right.id),
      );
      const sortedProviderGroup = providerGroup.toSorted((left, right) =>
        (left.providerItemId ?? '').localeCompare(right.providerItemId ?? ''),
      );
      for (const [index, localItem] of sortedLocalGroup.entries()) {
        const providerItem = sortedProviderGroup[index];
        if (providerItem) {
          reconcile(localItem, providerItem);
        }
      }
    }
  };

  matchGroups(
    (subscriptionItem) => `${subscriptionItem.priceId}\u0000${subscriptionItem.quantity}`,
    () => true,
  );
  matchGroups(
    (subscriptionItem) => subscriptionItem.priceId,
    (localGroup) => localGroup.every(({ quantity }) => quantity === localGroup[0]?.quantity),
  );

  return reconciliations;
}
