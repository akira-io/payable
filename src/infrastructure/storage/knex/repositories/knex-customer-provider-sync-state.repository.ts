import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  BeginCustomerProviderSyncAttempt,
  CustomerProviderSyncStateRepository,
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

  async beginAttempt(data: BeginCustomerProviderSyncAttempt): Promise<CustomerProviderSyncState> {
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
          return this.toEntity(row);
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
        }
        continue;
      }
      const updatedAt = this.clock.now();
      const attempts = existing.attempts + 1;
      const updated = await this.knex(TABLE)
        .where(this.key(data))
        .where({ attempts: existing.attempts })
        .update({
          status: 'pending',
          attempts,
          last_attempted_at: data.lastAttemptedAt.toISOString(),
          failure_code: null,
          updated_at: updatedAt.toISOString(),
        });
      if (updated > 0) {
        return {
          ...existing,
          status: 'pending',
          attempts,
          lastAttemptedAt: data.lastAttemptedAt,
          failureCode: null,
          updatedAt,
        };
      }
    }
  }

  async completeAttempt(
    data: NewCustomerProviderSyncState,
    expectedAttempts: number,
  ): Promise<CustomerProviderSyncState | null> {
    const updated = await this.knex(TABLE)
      .where(this.key(data))
      .where({ attempts: expectedAttempts })
      .update({
        status: data.status,
        provider_customer_id: data.providerCustomerId,
        last_attempted_at: data.lastAttemptedAt.toISOString(),
        synchronized_at: data.synchronizedAt?.toISOString() ?? null,
        failure_code: data.failureCode,
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
