import type {
  SubscriptionLineItem,
  SubscriptionProviderItemDTO,
} from '../../../domain/dtos/subscription.dto';

export function groupSubscriptionItems<T>(
  subscriptionItems: readonly T[],
  key: (subscriptionItem: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const subscriptionItem of subscriptionItems) {
    const groupKey = key(subscriptionItem);
    const group = groups.get(groupKey);
    if (group) {
      group.push(subscriptionItem);
    } else {
      groups.set(groupKey, [subscriptionItem]);
    }
  }
  return groups;
}

export function matchProviderSubscriptionItems(
  localItems: readonly SubscriptionLineItem[],
  providerItems: readonly SubscriptionProviderItemDTO[] | undefined,
): Array<SubscriptionLineItem & { providerItemId: string | null }> {
  const availableProviderItems = [...(providerItems ?? [])];
  const matchedProviderItems = new Map<number, SubscriptionProviderItemDTO>();
  const matchGroups = (
    key: (subscriptionItem: SubscriptionLineItem) => string,
    duplicateGroupIsSafe: (localGroup: readonly SubscriptionLineItem[]) => boolean,
  ): void => {
    const localGroups = groupSubscriptionItems(
      localItems
        .map((subscriptionItem, index) => ({ subscriptionItem, index }))
        .filter(({ index }) => !matchedProviderItems.has(index)),
      ({ subscriptionItem }) => key(subscriptionItem),
    );
    for (const [groupKey, localGroup] of localGroups) {
      const providerGroup = availableProviderItems.filter(
        (providerItem) => key(providerItem) === groupKey,
      );
      const safelyPairable =
        localGroup.length === providerGroup.length &&
        (localGroup.length === 1 ||
          (duplicateGroupIsSafe(localGroup.map(({ subscriptionItem }) => subscriptionItem)) &&
            providerGroup.every((providerItem) => providerItem.providerItemId !== null)));
      if (!safelyPairable) {
        continue;
      }
      const sortedProviderGroup = providerGroup.toSorted((left, right) =>
        (left.providerItemId ?? '').localeCompare(right.providerItemId ?? ''),
      );
      for (const [index, localEntry] of localGroup.entries()) {
        const providerItem = sortedProviderGroup[index];
        if (providerItem) {
          matchedProviderItems.set(localEntry.index, providerItem);
          availableProviderItems.splice(availableProviderItems.indexOf(providerItem), 1);
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

  return localItems.map((localItem, index) => {
    return {
      ...localItem,
      providerItemId: matchedProviderItems.get(index)?.providerItemId ?? null,
    };
  });
}
