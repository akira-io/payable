import type { SubscriptionProviderBinding } from '../entities/subscription-provider-binding.entity';

export type NewSubscriptionProviderBinding = Omit<
  SubscriptionProviderBinding,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface SubscriptionProviderBindingRepository {
  create(data: NewSubscriptionProviderBinding): Promise<SubscriptionProviderBinding>;
  findBySubscriptionAndProvider(
    subscriptionId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding | null>;
  findByProviderId(
    provider: string,
    providerSubscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding | null>;
  listBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding[]>;
  listBySubscriptionIds?(
    subscriptionIds: string[],
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding[]>;
  updateProviderSyncedAt(
    id: string,
    providerSyncedAt: Date,
    tenantId: string | null,
  ): Promise<SubscriptionProviderBinding>;
}
