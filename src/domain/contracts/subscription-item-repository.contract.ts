import type { SubscriptionItem } from '../entities/subscription-item.entity';

export type NewSubscriptionItem = Omit<SubscriptionItem, 'id' | 'createdAt' | 'updatedAt'>;

export interface SubscriptionItemRepository {
  create(data: NewSubscriptionItem): Promise<SubscriptionItem>;
  listBySubscription(subscriptionId: string): Promise<SubscriptionItem[]>;
}
