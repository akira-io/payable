import type { CustomerProviderSyncState } from '../entities/customer-provider-sync-state.entity';

export type NewCustomerProviderSyncState = Omit<
  CustomerProviderSyncState,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface CustomerProviderSyncStateRepository {
  upsert(data: NewCustomerProviderSyncState): Promise<CustomerProviderSyncState>;
  findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderSyncState | null>;
}
