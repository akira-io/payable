import type {
  CanonicalProductListQuery,
  CanonicalProductListResult,
  CanonicalProductPatch,
  CanonicalProductRepository,
  NewCanonicalProduct,
} from '../../../../domain/contracts/canonical-product-repository.contract';
import type { CanonicalProduct } from '../../../../domain/entities/canonical-product.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import { KnexRepository } from '../knex-repository';
import { fromJson, toBool, toDate, toJson } from '../mappers';

export class KnexCanonicalProductRepository
  extends KnexRepository<CanonicalProduct, NewCanonicalProduct>
  implements CanonicalProductRepository
{
  protected readonly table = 'payable_canonical_products';

  override create(product: NewCanonicalProduct): Promise<CanonicalProduct> {
    assertCatalogTenantId(product.tenantId);
    return super.create(product);
  }

  override findById(id: string, tenantId: string | null): Promise<CanonicalProduct | null> {
    assertCatalogTenantId(tenantId);
    return super.findById(id, tenantId);
  }

  override update(
    id: string,
    patch: CanonicalProductPatch,
    tenantId: string | null,
  ): Promise<CanonicalProduct> {
    assertCatalogTenantId(tenantId);
    return super.update(id, patch, tenantId);
  }

  async list(
    query: CanonicalProductListQuery,
    tenantId: string | null,
  ): Promise<CanonicalProductListResult> {
    assertCatalogTenantId(tenantId);
    let products = this.knex(this.table)
      .where('tenant_key', tenantId ?? '')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.id) {
      products = products.where('id', query.id);
    }
    if (query.active !== undefined) {
      products = products.where('active', query.active);
    }
    if (query.name) {
      products = products.whereRaw("LOWER(name) LIKE ? ESCAPE '\\'", [searchPattern(query.name)]);
    }
    if (query.description) {
      products = products.whereRaw("LOWER(description) LIKE ? ESCAPE '\\'", [
        searchPattern(query.description),
      ]);
    }
    if (query.before) {
      const createdAt = query.before.createdAt.toISOString();
      products = products.where((product) =>
        product
          .where('created_at', '<', createdAt)
          .orWhere((tie) =>
            tie.where('created_at', createdAt).andWhere('id', '<', query.before?.id ?? ''),
          ),
      );
    }
    const rows = (await products.limit(query.limit + 1)) as Record<string, unknown>[];
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  protected toEntity(row: Record<string, unknown>): CanonicalProduct {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      active: toBool(row.active),
      metadata: toJson(row.metadata),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected override createLookupTenantId(product: NewCanonicalProduct): string | null {
    return product.tenantId;
  }

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { id, tenant_id: tenantId };
  }

  protected toRow(product: Partial<NewCanonicalProduct>): Record<string, unknown> {
    return {
      tenant_id: product.tenantId,
      tenant_key: product.tenantId === undefined ? undefined : (product.tenantId ?? ''),
      name: product.name,
      description: product.description,
      active: product.active,
      metadata: product.metadata === undefined ? undefined : fromJson(product.metadata),
    };
  }
}

function searchPattern(search: string): string {
  const escaped = search.toLocaleLowerCase('en-US').replace(/[\\%_]/gu, '\\$&');
  return `%${escaped}%`;
}
