import type { CustomerProviderSyncState } from '../entities/customer-provider-sync-state.entity';

export type NewCustomerProviderSyncState = Omit<
  CustomerProviderSyncState,
  'id' | 'createdAt' | 'updatedAt'
>;

export type BeginCustomerProviderSyncAttempt = Pick<
  NewCustomerProviderSyncState,
  'tenantId' | 'customerId' | 'provider' | 'lastAttemptedAt' | 'attemptOwnerId' | 'leaseExpiresAt'
> & { readonly allowReconciliationRepair?: boolean };

export interface CustomerProviderSyncAttemptClaim {
  readonly state: CustomerProviderSyncState;
  readonly acquired: boolean;
  readonly previous: CustomerProviderSyncState | null;
}

export interface ExpectedCustomerProviderSyncAttempt {
  readonly attempts: number;
  readonly ownerId: string;
}

export interface CustomerProviderSyncStateRepository {
  beginAttempt(data: BeginCustomerProviderSyncAttempt): Promise<CustomerProviderSyncAttemptClaim>;
  completeAttempt(
    data: NewCustomerProviderSyncState,
    expected: ExpectedCustomerProviderSyncAttempt,
  ): Promise<CustomerProviderSyncState | null>;
  findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderSyncState | null>;
}
