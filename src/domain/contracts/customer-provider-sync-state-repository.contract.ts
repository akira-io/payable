import type { CustomerProviderSyncState } from '../entities/customer-provider-sync-state.entity';

export type NewCustomerProviderSyncState = Omit<
  CustomerProviderSyncState,
  'id' | 'createdAt' | 'updatedAt'
>;

export type BeginCustomerProviderSyncAttempt = Pick<
  NewCustomerProviderSyncState,
  'tenantId' | 'customerId' | 'provider' | 'lastAttemptedAt'
>;

export interface CustomerProviderSyncStateRepository {
  beginAttempt(data: BeginCustomerProviderSyncAttempt): Promise<CustomerProviderSyncState>;
  completeAttempt(
    data: NewCustomerProviderSyncState,
    expectedAttempts: number,
  ): Promise<CustomerProviderSyncState | null>;
  findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderSyncState | null>;
}
