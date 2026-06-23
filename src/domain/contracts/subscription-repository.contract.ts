import type { Subscription } from '../entities/subscription.entity';
import type { ListOptions } from './list-options.contract';

export type NewSubscription = Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>;

export interface SubscriptionRepository {
  create(data: NewSubscription): Promise<Subscription>;
  update(
    id: string,
    patch: Partial<NewSubscription>,
    tenantId?: string | null,
  ): Promise<Subscription>;
  findById(id: string, tenantId?: string | null): Promise<Subscription | null>;
  findByName(customerId: string, name: string): Promise<Subscription | null>;
  findByProviderId(provider: string, providerSubscriptionId: string): Promise<Subscription | null>;
  listByCustomer(customerId: string, options?: ListOptions): Promise<Subscription[]>;
}
