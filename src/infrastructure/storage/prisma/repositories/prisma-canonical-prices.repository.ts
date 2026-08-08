import type {
  CanonicalPriceListQuery,
  CanonicalPriceListResult,
  CanonicalPricePatch,
  CanonicalPriceRepository,
  NewCanonicalPrice,
} from '../../../../domain/contracts/canonical-price-repository.contract';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { CanonicalPrice } from '../../../../domain/entities/canonical-price.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import { fromMinor, toMinor } from '../mappers/shared';
import type { PrismaCanonicalPriceRow, PrismaClient } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaCanonicalPriceRepository
  extends PrismaRepository<CanonicalPrice, NewCanonicalPrice, PrismaCanonicalPriceRow>
  implements CanonicalPriceRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableCanonicalPrice, clock);
  }

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
    const locked = await this.delegate.updateMany({
      where: { id, tenantId, active: true, type: 'recurring' },
      data: { active: true },
    });
    if (locked.count === 0) return null;
    return this.findById(id, tenantId);
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
    return this.firstWhere({ lookupKey, tenantId });
  }

  async list(
    query: CanonicalPriceListQuery,
    tenantId: string | null,
  ): Promise<CanonicalPriceListResult> {
    assertCatalogTenantId(tenantId);
    const filters: Record<string, unknown>[] = [
      { tenantId },
      query.active === undefined ? {} : { active: query.active },
      query.productId ? { productId: query.productId } : {},
      query.type ? { type: query.type } : {},
      query.lookupKeys ? { lookupKey: { in: query.lookupKeys } } : {},
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

  protected toEntity(row: PrismaCanonicalPriceRow): CanonicalPrice {
    return {
      id: row.id,
      tenantId: row.tenantId,
      productId: row.productId,
      currency: row.currency as CanonicalPrice['currency'],
      unitAmount: toMinor(row.unitAmount, 'unit_amount'),
      type: row.type as CanonicalPrice['type'],
      interval: row.interval as CanonicalPrice['interval'],
      intervalCount: row.intervalCount,
      description: row.description,
      lookupKey: row.lookupKey,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { id, tenantId };
  }

  protected toRow(price: Partial<NewCanonicalPrice>): Record<string, unknown> {
    return {
      tenantId: price.tenantId,
      tenantKey: price.tenantId === undefined ? undefined : (price.tenantId ?? ''),
      productId: price.productId,
      currency: price.currency,
      unitAmount: fromMinor(price.unitAmount),
      type: price.type,
      interval: price.interval,
      intervalCount: price.intervalCount,
      description: price.description,
      lookupKey: price.lookupKey,
      active: price.active,
    };
  }

  protected override toUpdateRow(price: Partial<NewCanonicalPrice>): Record<string, unknown> {
    return {
      description: price.description,
      lookupKey: price.lookupKey,
      active: price.active,
    };
  }
}
