import type {
  CanonicalPriceListQuery,
  CanonicalPriceListResult,
  CanonicalPricePatch,
  CanonicalPriceRepository,
  NewCanonicalPrice,
} from '../../../../domain/contracts/canonical-price-repository.contract';
import type { CanonicalPrice } from '../../../../domain/entities/canonical-price.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import { KnexRepository } from '../knex-repository';
import { toBool, toDate } from '../mappers';

export class KnexCanonicalPriceRepository
  extends KnexRepository<CanonicalPrice, NewCanonicalPrice>
  implements CanonicalPriceRepository
{
  protected readonly table = 'payable_canonical_prices';

  override create(price: NewCanonicalPrice): Promise<CanonicalPrice> {
    assertCatalogTenantId(price.tenantId);
    return super.create(price);
  }

  override findById(id: string, tenantId: string | null): Promise<CanonicalPrice | null> {
    assertCatalogTenantId(tenantId);
    return super.findById(id, tenantId);
  }

  async findActiveRecurringByIdForUpdate(
    id: string,
    tenantId: string | null,
  ): Promise<CanonicalPrice | null> {
    assertCatalogTenantId(tenantId);
    const query = this.knex(this.table).where({
      id,
      tenant_key: tenantId ?? '',
      active: true,
      type: 'recurring',
    });
    if (this.supportsRowLocking()) query.forUpdate();
    const row = await query.first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  override update(
    id: string,
    patch: Partial<CanonicalPricePatch>,
    tenantId: string | null,
  ): Promise<CanonicalPrice> {
    assertCatalogTenantId(tenantId);
    return super.update(id, patch, tenantId);
  }

  findByLookupKey(lookupKey: string, tenantId: string | null): Promise<CanonicalPrice | null> {
    assertCatalogTenantId(tenantId);
    return this.firstWhere({ lookup_key: lookupKey, tenant_key: tenantId ?? '' });
  }

  async list(
    query: CanonicalPriceListQuery,
    tenantId: string | null,
  ): Promise<CanonicalPriceListResult> {
    assertCatalogTenantId(tenantId);
    let prices = this.knex(this.table)
      .whereRaw("COALESCE(tenant_id, '') = ?", [tenantId ?? ''])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.active !== undefined) {
      prices = prices.where('active', query.active);
    }
    if (query.productId) {
      prices = prices.where('product_id', query.productId);
    }
    if (query.type) {
      prices = prices.where('type', query.type);
    }
    if (query.lookupKeys) {
      prices = prices.whereIn('lookup_key', query.lookupKeys);
    }
    if (query.before) {
      const before = query.before;
      const createdAt = before.createdAt.toISOString();
      prices = prices.where((price) =>
        price
          .where('created_at', '<', createdAt)
          .orWhere((tie) => tie.where('created_at', createdAt).andWhere('id', '<', before.id)),
      );
    }
    const rows = (await prices.limit(query.limit + 1)) as Record<string, unknown>[];
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  protected toEntity(row: Record<string, unknown>): CanonicalPrice {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      productId: row.product_id as string,
      currency: row.currency as CanonicalPrice['currency'],
      unitAmount: Number(row.unit_amount),
      type: row.type as CanonicalPrice['type'],
      interval: (row.interval as CanonicalPrice['interval']) ?? null,
      intervalCount: (row.interval_count as number | null) ?? null,
      description: (row.description as string | null) ?? null,
      lookupKey: (row.lookup_key as string | null) ?? null,
      active: toBool(row.active),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected override createLookupTenantId(price: NewCanonicalPrice): string | null {
    return price.tenantId;
  }

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { id, tenant_id: tenantId };
  }

  protected toRow(price: Partial<NewCanonicalPrice>): Record<string, unknown> {
    return {
      tenant_id: price.tenantId,
      tenant_key: price.tenantId === undefined ? undefined : (price.tenantId ?? ''),
      product_id: price.productId,
      currency: price.currency,
      unit_amount: price.unitAmount,
      type: price.type,
      interval: price.interval,
      interval_count: price.intervalCount,
      description: price.description,
      lookup_key: price.lookupKey,
      active: price.active,
    };
  }

  protected override toUpdateRow(price: Partial<NewCanonicalPrice>): Record<string, unknown> {
    return {
      description: price.description,
      lookup_key: price.lookupKey,
      active: price.active,
    };
  }
}
