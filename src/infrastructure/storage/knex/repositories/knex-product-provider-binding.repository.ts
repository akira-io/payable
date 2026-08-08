import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewProductProviderBinding,
  ProductProviderBindingRepository,
} from '../../../../domain/contracts/product-provider-binding-repository.contract';
import type { ProductProviderBinding } from '../../../../domain/entities/product-provider-binding.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';

const TABLE = 'payable_product_provider_bindings';

export class KnexProductProviderBindingRepository implements ProductProviderBindingRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(binding: NewProductProviderBinding): Promise<ProductProviderBinding> {
    assertCatalogTenantId(binding.tenantId);
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    const [inserted] = await this.knex(TABLE)
      .insert({
        id,
        tenant_id: binding.tenantId,
        tenant_key: binding.tenantId ?? '',
        product_id: binding.productId,
        provider: binding.provider,
        provider_product_id: binding.providerProductId,
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

  async updateProviderId(id: string, providerProductId: string): Promise<ProductProviderBinding> {
    const [updated] = await this.knex(TABLE)
      .where({ id })
      .update({
        provider_product_id: providerProductId,
        updated_at: this.clock.now().toISOString(),
      })
      .returning('*');
    const row = updated ?? (await this.knex(TABLE).where({ id }).first());
    if (!row) {
      throw new Error(`${TABLE}: row ${id} missing after update`);
    }
    return this.toEntity(row as Record<string, unknown>);
  }

  async findByProductAndProvider(
    productId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null> {
    return this.firstWhere({ product_id: productId, provider }, tenantId);
  }

  async findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null> {
    return this.firstWhere({ provider, provider_product_id: providerProductId }, tenantId);
  }

  async listByProductId(
    productId: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding[]> {
    assertCatalogTenantId(tenantId);
    const rows = (await this.knex(TABLE)
      .where({ product_id: productId, tenant_key: tenantId ?? '' })
      .orderBy('provider', 'asc')) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  private async firstWhere(
    query: Record<string, unknown>,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null> {
    assertCatalogTenantId(tenantId);
    const row = await this.knex(TABLE)
      .where({ ...query, tenant_key: tenantId ?? '' })
      .first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  private toEntity(row: Record<string, unknown>): ProductProviderBinding {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      productId: row.product_id as string,
      provider: row.provider as string,
      providerProductId: row.provider_product_id as string,
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
    };
  }
}
