import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  CustomerProviderSyncStateRepository,
  NewCustomerProviderSyncState,
} from '../../../../domain/contracts/customer-provider-sync-state-repository.contract';
import type { CustomerProviderSyncState } from '../../../../domain/entities/customer-provider-sync-state.entity';

const TABLE = 'payable_customer_provider_sync_states';

export class KnexCustomerProviderSyncStateRepository
  implements CustomerProviderSyncStateRepository
{
  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async upsert(data: NewCustomerProviderSyncState): Promise<CustomerProviderSyncState> {
    const timestamp = this.clock.now().toISOString();
    const row = {
      id: globalThis.crypto.randomUUID(),
      tenant_id: data.tenantId,
      tenant_key: data.tenantId ?? '',
      customer_id: data.customerId,
      provider: data.provider,
      status: data.status,
      provider_customer_id: data.providerCustomerId,
      attempts: data.attempts,
      last_attempted_at: data.lastAttemptedAt.toISOString(),
      synchronized_at: data.synchronizedAt?.toISOString() ?? null,
      failure_code: data.failureCode,
      created_at: timestamp,
      updated_at: timestamp,
    };
    await this.knex(TABLE).insert(row).onConflict(['tenant_key', 'customer_id', 'provider']).merge({
      status: row.status,
      provider_customer_id: row.provider_customer_id,
      attempts: row.attempts,
      last_attempted_at: row.last_attempted_at,
      synchronized_at: row.synchronized_at,
      failure_code: row.failure_code,
      updated_at: row.updated_at,
    });
    const persisted = await this.knex(TABLE)
      .where({
        tenant_key: row.tenant_key,
        customer_id: row.customer_id,
        provider: row.provider,
      })
      .first();
    if (!persisted) {
      throw new Error(`${TABLE}: row missing after write`);
    }
    return this.toEntity(persisted as Record<string, unknown>);
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
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
    };
  }
}
