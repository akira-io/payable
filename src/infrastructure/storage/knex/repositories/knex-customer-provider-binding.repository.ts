import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  CustomerProviderBindingRepository,
  NewCustomerProviderBinding,
} from '../../../../domain/contracts/customer-provider-binding-repository.contract';
import type { CustomerProviderBinding } from '../../../../domain/entities/customer-provider-binding.entity';

const TABLE = 'payable_customer_provider_bindings';

export class KnexCustomerProviderBindingRepository implements CustomerProviderBindingRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(data: NewCustomerProviderBinding): Promise<CustomerProviderBinding> {
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    const [inserted] = await this.knex(TABLE)
      .insert({
        id,
        customer_id: data.customerId,
        provider: data.provider,
        provider_customer_id: data.providerCustomerId,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning('*');
    const row = inserted ?? (await this.knex(TABLE).where({ id }).first());
    if (!row) {
      throw new Error(`${TABLE}: row ${id} missing after write`);
    }
    return this.toEntity(row as Record<string, unknown>);
  }

  async findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null> {
    const row = await this.scopedQuery(tenantId)
      .where('binding.customer_id', customerId)
      .where('binding.provider', provider)
      .first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  async findByProviderId(
    provider: string,
    providerCustomerId: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null> {
    const row = await this.scopedQuery(tenantId)
      .where('binding.provider', provider)
      .where('binding.provider_customer_id', providerCustomerId)
      .first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  private scopedQuery(tenantId: string | null): Knex.QueryBuilder {
    return this.knex(`${TABLE} as binding`)
      .join('payable_customers as customer', 'customer.id', 'binding.customer_id')
      .select('binding.*')
      .whereRaw("COALESCE(customer.tenant_id, '') = ?", [tenantId ?? '']);
  }

  private toEntity(row: Record<string, unknown>): CustomerProviderBinding {
    return {
      id: row.id as string,
      customerId: row.customer_id as string,
      provider: row.provider as string,
      providerCustomerId: row.provider_customer_id as string,
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
    };
  }
}
