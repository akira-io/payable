import type { Subscription } from '../entities/subscription.entity';

export type NewSubscription = Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>;

export interface SubscriptionRepository {
  create(data: NewSubscription): Promise<Subscription>;
  update(id: string, patch: Partial<NewSubscription>): Promise<Subscription>;
  findById(id: string): Promise<Subscription | null>;
  findByName(customerId: string, name: string): Promise<Subscription | null>;
  findByProviderId(provider: string, providerSubscriptionId: string): Promise<Subscription | null>;
  listByCustomer(customerId: string): Promise<Subscription[]>;
}
