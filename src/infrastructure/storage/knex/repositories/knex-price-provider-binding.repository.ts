import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewPriceProviderBinding,
  PriceProviderBindingRepository,
} from '../../../../domain/contracts/price-provider-binding-repository.contract';
import type { PriceProviderBinding } from '../../../../domain/entities/price-provider-binding.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';

const TABLE = 'payable_price_provider_bindings';

export class KnexPriceProviderBindingRepository implements PriceProviderBindingRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(binding: NewPriceProviderBinding): Promise<PriceProviderBinding> {
    assertCatalogTenantId(binding.tenantId);
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    const [inserted] = await this.knex(TABLE)
      .insert({
        id,
        tenant_id: binding.tenantId,
        tenant_key: binding.tenantId ?? '',
        price_id: binding.priceId,
        provider: binding.provider,
        provider_price_id: binding.providerPriceId,
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

  async updateProviderId(id: string, providerPriceId: string): Promise<PriceProviderBinding> {
    const [updated] = await this.knex(TABLE)
      .where({ id })
      .update({ provider_price_id: providerPriceId, updated_at: this.clock.now().toISOString() })
      .returning('*');
    const row = updated ?? (await this.knex(TABLE).where({ id }).first());
    if (!row) {
      throw new Error(`${TABLE}: row ${id} missing after update`);
    }
    return this.toEntity(row as Record<string, unknown>);
  }

  findByPriceAndProvider(
    priceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null> {
    return this.firstWhere({ price_id: priceId, provider }, tenantId);
  }

  findByProviderId(
    provider: string,
    providerPriceId: string,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null> {
    return this.firstWhere({ provider, provider_price_id: providerPriceId }, tenantId);
  }

  async listByPriceId(priceId: string, tenantId: string | null): Promise<PriceProviderBinding[]> {
    assertCatalogTenantId(tenantId);
    const rows = (await this.knex(TABLE)
      .where({ price_id: priceId, tenant_key: tenantId ?? '' })
      .orderBy('provider', 'asc')) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  private async firstWhere(
    query: Record<string, unknown>,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null> {
    assertCatalogTenantId(tenantId);
    const row = await this.knex(TABLE)
      .where({ ...query, tenant_key: tenantId ?? '' })
      .first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  private toEntity(row: Record<string, unknown>): PriceProviderBinding {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      priceId: row.price_id as string,
      provider: row.provider as string,
      providerPriceId: row.provider_price_id as string,
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
    };
  }
}
