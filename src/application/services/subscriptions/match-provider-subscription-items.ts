import type {
  SubscriptionLineItem,
  SubscriptionProviderItemDTO,
} from '../../../domain/dtos/subscription.dto';

export function matchProviderSubscriptionItems(
  localItems: readonly SubscriptionLineItem[],
  providerItems: readonly SubscriptionProviderItemDTO[] | undefined,
): Array<SubscriptionLineItem & { providerItemId: string | null }> {
  return localItems.map((localItem) => {
    const localMatches = localItems.filter((candidate) => candidate.priceId === localItem.priceId);
    const providerMatches = (providerItems ?? []).filter(
      (candidate) => candidate.priceId === localItem.priceId,
    );
    const providerItemId =
      localMatches.length === 1 && providerMatches.length === 1
        ? (providerMatches[0]?.providerItemId ?? null)
        : null;
    return { ...localItem, providerItemId };
  });
}
