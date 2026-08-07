import type Stripe from 'stripe';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';

export function stripeSubscriptionItems(
  subscription: Stripe.Subscription,
): SubscriptionDTO['items'] {
  return subscription.items?.data.flatMap((subscriptionItem) =>
    subscriptionItem.price
      ? [
          {
            providerItemId: subscriptionItem.id,
            priceId: subscriptionItem.price.id,
            quantity: subscriptionItem.quantity ?? 1,
          },
        ]
      : [],
  );
}

export function stripeWebhookSubscriptionItems(rawItems: unknown): SubscriptionDTO['items'] {
  if (!Array.isArray(rawItems)) {
    return undefined;
  }
  return rawItems.flatMap((rawItem) => {
    const subscriptionItem = rawItem as Record<string, unknown>;
    const price = subscriptionItem.price as Record<string, unknown> | undefined;
    if (typeof subscriptionItem.id !== 'string' || typeof price?.id !== 'string') {
      return [];
    }
    return [
      {
        providerItemId: subscriptionItem.id,
        priceId: price.id,
        quantity: typeof subscriptionItem.quantity === 'number' ? subscriptionItem.quantity : 1,
      },
    ];
  });
}
