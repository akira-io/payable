import type {
  CanonicalProductListQuery,
  CanonicalProductListResult,
  CanonicalProductPatch,
  CanonicalProductRepository,
  NewCanonicalProduct,
} from '../../../../domain/contracts/canonical-product-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { CanonicalProduct } from '../../../../domain/entities/canonical-product.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import { parseJson, toJsonString } from '../mappers/shared';
import type { PrismaCanonicalProductRow, PrismaClient } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaCanonicalProductRepository
  extends PrismaRepository<CanonicalProduct, NewCanonicalProduct, PrismaCanonicalProductRow>
  implements CanonicalProductRepository
{
  private readonly supportsInsensitiveMode: boolean;

  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableCanonicalProduct, clock);
    const activeProvider = (client as unknown as { _activeProvider?: string })._activeProvider;
    this.supportsInsensitiveMode =
      activeProvider === 'postgresql' ||
      activeProvider === 'cockroachdb' ||
      activeProvider === 'mongodb';
  }

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
    const filters: Record<string, unknown>[] = [
      { tenantKey: tenantId ?? '' },
      query.id ? { id: query.id } : {},
      query.active === undefined ? {} : { active: query.active },
      query.name ? { name: this.textSearch(query.name) } : {},
      query.description ? { description: this.textSearch(query.description) } : {},
    ];
    if (query.before) {
      filters.push({
        OR: [
          { createdAt: { lt: query.before.createdAt } },
          { createdAt: query.before.createdAt, id: { lt: query.before.id } },
        ],
      });
    }
    const rows = await this.delegate.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  protected toEntity(row: PrismaCanonicalProductRow): CanonicalProduct {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      active: row.active,
      metadata: parseJson(row.metadata),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { id, tenantId };
  }

  protected toRow(product: Partial<NewCanonicalProduct>): Record<string, unknown> {
    return {
      tenantId: product.tenantId,
      tenantKey: product.tenantId === undefined ? undefined : (product.tenantId ?? ''),
      name: product.name,
      description: product.description,
      active: product.active,
      metadata: toJsonString(product.metadata),
    };
  }

  private textSearch(search: string): Record<string, unknown> {
    return this.supportsInsensitiveMode
      ? { contains: search, mode: 'insensitive' }
      : { contains: search };
  }
}
