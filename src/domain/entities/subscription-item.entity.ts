import type { Timestamps } from './common';

export interface SubscriptionItem extends Timestamps {
  readonly id: string;
  readonly subscriptionId: string;
  readonly priceId: string;
  readonly providerItemId: string | null;
  readonly quantity: number;
}
