import type { SubscriptionItem } from '../entities/subscription-item.entity';

export type NewSubscriptionItem = Omit<SubscriptionItem, 'id' | 'createdAt' | 'updatedAt'>;

export interface SubscriptionItemPatch {
  priceId?: string;
  providerItemId?: string | null;
  quantity?: number;
}

export interface SubscriptionItemRepository {
  create(data: NewSubscriptionItem): Promise<SubscriptionItem>;
  createMany(data: NewSubscriptionItem[]): Promise<void>;
  updatePrimary(
    subscriptionId: string,
    patch: SubscriptionItemPatch,
    tenantId?: string | null,
  ): Promise<void>;
  updateById(
    subscriptionId: string,
    itemId: string,
    patch: SubscriptionItemPatch,
    tenantId?: string | null,
  ): Promise<void>;
  listBySubscription(subscriptionId: string, tenantId?: string | null): Promise<SubscriptionItem[]>;
}
