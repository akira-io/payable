import type { SubscriptionItem } from '../entities/subscription-item.entity';

export type NewSubscriptionItem = Omit<SubscriptionItem, 'id' | 'createdAt' | 'updatedAt'>;

export interface SubscriptionItemPatch {
  priceId?: string;
  quantity?: number;
}

export interface SubscriptionItemRepository {
  create(data: NewSubscriptionItem): Promise<SubscriptionItem>;
  createMany(data: NewSubscriptionItem[]): Promise<void>;
  updatePrimary(subscriptionId: string, patch: SubscriptionItemPatch): Promise<void>;
  listBySubscription(subscriptionId: string): Promise<SubscriptionItem[]>;
}
