import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  BeginCustomerProviderSyncAttempt,
  CustomerProviderSyncAttemptClaim,
  CustomerProviderSyncStateRepository,
  ExpectedCustomerProviderSyncAttempt,
  NewCustomerProviderSyncState,
} from '../../../../domain/contracts/customer-provider-sync-state-repository.contract';
import type { CustomerProviderSyncState } from '../../../../domain/entities/customer-provider-sync-state.entity';
import { isUniqueViolation } from '../unique-violation';

const TABLE = 'payable_customer_provider_sync_states';

export class KnexCustomerProviderSyncStateRepository
  implements CustomerProviderSyncStateRepository
{
  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async beginAttempt(
    data: BeginCustomerProviderSyncAttempt,
  ): Promise<CustomerProviderSyncAttemptClaim> {
    for (;;) {
      const existing = await this.findByCustomerAndProvider(
        data.customerId,
        data.provider,
        data.tenantId,
      );
      if (!existing) {
        try {
          const row = this.newAttemptRow(data);
          await this.knex(TABLE).insert(row);
          return { state: this.toEntity(row), acquired: true, previous: null };
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
        }
        continue;
      }
      if (requiresManualReconciliation(existing) && !data.allowReconciliationRepair) {
        return { state: existing, acquired: false, previous: existing };
      }
      if (hasActiveLease(existing, this.clock.now())) {
        return { state: existing, acquired: false, previous: existing };
      }
      if (existing.status === 'pending' && !data.allowExpiredLeaseReclaim) {
        const reconciliation = await this.expirePendingAttempt(data, existing);
        if (reconciliation) {
          return { state: reconciliation, acquired: false, previous: existing };
        }
        continue;
      }
      const updatedAt = this.clock.now();
      const attempts = existing.attempts + 1;
      const updated = await this.knex(TABLE)
        .where(this.key(data))
        .where({
          attempts: existing.attempts,
          status: existing.status,
          attempt_owner_id: existing.attemptOwnerId,
        })
        .update({
          status: 'pending',
          attempts,
          last_attempted_at: data.lastAttemptedAt.toISOString(),
          failure_code: null,
          attempt_owner_id: data.attemptOwnerId,
          lease_expires_at: data.leaseExpiresAt?.toISOString() ?? null,
          updated_at: updatedAt.toISOString(),
        });
      if (updated > 0) {
        return {
          acquired: true,
          previous: existing,
          state: {
            ...existing,
            status: 'pending',
            attempts,
            lastAttemptedAt: data.lastAttemptedAt,
            failureCode: null,
            attemptOwnerId: data.attemptOwnerId,
            leaseExpiresAt: data.leaseExpiresAt,
            updatedAt,
          },
        };
      }
    }
  }

  async completeAttempt(
    data: NewCustomerProviderSyncState,
    expected: ExpectedCustomerProviderSyncAttempt,
  ): Promise<CustomerProviderSyncState | null> {
    const updated = await this.knex(TABLE)
      .where(this.key(data))
      .where({ attempts: expected.attempts, attempt_owner_id: expected.ownerId })
      .update({
        status: data.status,
        provider_customer_id: data.providerCustomerId,
        last_attempted_at: data.lastAttemptedAt.toISOString(),
        synchronized_at: data.synchronizedAt?.toISOString() ?? null,
        failure_code: data.failureCode,
        attempt_owner_id: null,
        lease_expires_at: null,
        updated_at: this.clock.now().toISOString(),
      });
    return updated > 0 ? this.requirePersisted(data) : null;
  }

  async findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderSyncState | null> {
    const row = await this.knex(TABLE)
      .where({ tenant_key: tenantId ?? '', customer_id: customerId, provider })
      .first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  private toEntity(row: Record<string, unknown>): CustomerProviderSyncState {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      customerId: row.customer_id as string,
      provider: row.provider as string,
      status: row.status as CustomerProviderSyncState['status'],
      providerCustomerId: (row.provider_customer_id as string | null) ?? null,
      attempts: Number(row.attempts),
      lastAttemptedAt: new Date(row.last_attempted_at as string | Date),
      synchronizedAt: row.synchronized_at ? new Date(row.synchronized_at as string | Date) : null,
      failureCode: (row.failure_code as string | null) ?? null,
      attemptOwnerId: (row.attempt_owner_id as string | null) ?? null,
      leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at as string | Date) : null,
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
    };
  }

  private key(data: { tenantId: string | null; customerId: string; provider: string }) {
    return {
      tenant_key: data.tenantId ?? '',
      customer_id: data.customerId,
      provider: data.provider,
    };
  }

  private async expirePendingAttempt(
    data: BeginCustomerProviderSyncAttempt,
    existing: CustomerProviderSyncState,
  ): Promise<CustomerProviderSyncState | null> {
    const updatedAt = this.clock.now();
    const updated = await this.knex(TABLE)
      .where(this.key(data))
      .where({
        attempts: existing.attempts,
        status: 'pending',
        attempt_owner_id: existing.attemptOwnerId,
      })
      .update({
        status: 'reconciliation_required',
        failure_code: 'CUSTOMER_PROVIDER_SYNC_LEASE_EXPIRED',
        lease_expires_at: null,
        updated_at: updatedAt.toISOString(),
      });
    if (updated === 0) {
      return null;
    }
    return {
      ...existing,
      status: 'reconciliation_required',
      failureCode: 'CUSTOMER_PROVIDER_SYNC_LEASE_EXPIRED',
      leaseExpiresAt: null,
      updatedAt,
    };
  }

  private newAttemptRow(data: BeginCustomerProviderSyncAttempt) {
    const timestamp = this.clock.now().toISOString();
    return {
      id: globalThis.crypto.randomUUID(),
      tenant_id: data.tenantId,
      ...this.key(data),
      status: 'pending',
      provider_customer_id: null,
      attempts: 1,
      last_attempted_at: data.lastAttemptedAt.toISOString(),
      synchronized_at: null,
      failure_code: null,
      attempt_owner_id: data.attemptOwnerId,
      lease_expires_at: data.leaseExpiresAt?.toISOString() ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  private async requirePersisted(data: {
    tenantId: string | null;
    customerId: string;
    provider: string;
  }): Promise<CustomerProviderSyncState> {
    const persisted = await this.knex(TABLE).where(this.key(data)).first();
    if (!persisted) {
      throw new Error(`${TABLE}: row missing after write`);
    }
    return this.toEntity(persisted as Record<string, unknown>);
  }
}

function hasActiveLease(state: CustomerProviderSyncState, now: Date): boolean {
  return (
    state.status === 'pending' &&
    state.attemptOwnerId !== null &&
    state.leaseExpiresAt !== null &&
    state.leaseExpiresAt.getTime() > now.getTime()
  );
}

function requiresManualReconciliation(state: CustomerProviderSyncState): boolean {
  return state.status === 'reconciliation_required' && state.providerCustomerId === null;
}
