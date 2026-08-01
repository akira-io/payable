import type {
  NewProduct,
  ProductPatch,
  ProductRepository,
} from '../../../../domain/contracts/product-repository.contract';
import type { Product } from '../../../../domain/entities/product.entity';
import { assertCatalogTenantId, assertCatalogTenantIds } from '../../catalog-tenant';
import { KnexRepository } from '../knex-repository';
import { fromJson, stripUndefined, toBool, toDate, toJson } from '../mappers';

export class KnexProductRepository
  extends KnexRepository<Product, NewProduct>
  implements ProductRepository
{
  protected readonly table = 'payable_products';

  override async create(data: NewProduct): Promise<Product> {
    assertCatalogTenantId(data.tenantId);
    return super.create(data);
  }

  override async createMany(data: NewProduct[]): Promise<void> {
    assertCatalogTenantIds(data);
    return super.createMany(data);
  }

  override async findById(id: string, tenantId: string | null): Promise<Product | null> {
    assertCatalogTenantId(tenantId);
    return super.findById(id, tenantId);
  }

  override async update(
    id: string,
    patch: ProductPatch,
    tenantId: string | null,
  ): Promise<Product> {
    assertCatalogTenantId(tenantId);
    return super.update(id, patch, tenantId);
  }

  async updateIfUnchanged(
    id: string,
    expected: Product,
    patch: ProductPatch,
    tenantId: string | null,
  ): Promise<Product | null> {
    assertCatalogTenantId(tenantId);
    const updated = await this.knex(this.table)
      .where({
        ...this.scopedWhere(id, tenantId),
        ...this.toUpdateRow(expected),
      })
      .update(
        stripUndefined({ ...this.toUpdateRow(patch), updated_at: this.clock.now().toISOString() }),
      );
    return updated > 0 ? this.findByIdOrFail(id, tenantId) : null;
  }

  async findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId: string | null,
  ): Promise<Product | null> {
    assertCatalogTenantId(tenantId);
    return this.firstWhere({
      provider,
      provider_product_id: providerProductId,
      ...this.tenantClause(tenantId),
    });
  }

  protected toEntity(row: Record<string, unknown>): Product {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      provider: row.provider as string,
      providerProductId: (row.provider_product_id as string | null) ?? null,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      active: toBool(row.active),
      metadata: toJson(row.metadata),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected override createLookupTenantId(data: NewProduct): string | null {
    return data.tenantId;
  }

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { id, tenant_id: tenantId };
  }

  protected override tenantClause(tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { tenant_id: tenantId };
  }

  protected toRow(data: Partial<NewProduct>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      tenant_key: data.tenantId === undefined ? undefined : (data.tenantId ?? ''),
      provider: data.provider,
      provider_product_id: data.providerProductId,
      name: data.name,
      description: data.description,
      active: data.active,
      metadata: data.metadata === undefined ? undefined : fromJson(data.metadata),
    };
  }

  protected override toUpdateRow(data: Partial<NewProduct>): Record<string, unknown> {
    return {
      provider: data.provider,
      provider_product_id: data.providerProductId,
      name: data.name,
      description: data.description,
      active: data.active,
      metadata: data.metadata === undefined ? undefined : fromJson(data.metadata),
    };
  }
}
