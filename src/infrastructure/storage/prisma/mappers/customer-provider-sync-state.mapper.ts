import type { NewCustomerProviderSyncState } from '../../../../domain/contracts/customer-provider-sync-state-repository.contract';
import type { CustomerProviderSyncState } from '../../../../domain/entities/customer-provider-sync-state.entity';
import type { PrismaCustomerProviderSyncStateRow } from '../prisma-client.types';

export function customerProviderSyncStateToEntity(
  row: PrismaCustomerProviderSyncStateRow,
): CustomerProviderSyncState {
  return {
    ...row,
    status: row.status as CustomerProviderSyncState['status'],
  };
}

export function customerProviderSyncStateToRow(
  data: NewCustomerProviderSyncState,
): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    tenantKey: data.tenantId ?? '',
    customerId: data.customerId,
    provider: data.provider,
    status: data.status,
    providerCustomerId: data.providerCustomerId,
    attempts: data.attempts,
    lastAttemptedAt: data.lastAttemptedAt,
    synchronizedAt: data.synchronizedAt,
    failureCode: data.failureCode,
    attemptOwnerId: data.attemptOwnerId,
    leaseExpiresAt: data.leaseExpiresAt,
  };
}
