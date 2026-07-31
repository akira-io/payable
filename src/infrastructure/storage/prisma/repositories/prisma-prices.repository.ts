import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewPrice,
  PricePatch,
  PriceRepository,
} from '../../../../domain/contracts/price-repository.contract';
import type { Price } from '../../../../domain/entities/price.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import { pricePatchToRow, priceToEntity, priceToRow } from '../mappers/price.mapper';
import type { PrismaClient, PrismaPriceRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaPriceRepository
  extends PrismaRepository<Price, NewPrice, PrismaPriceRow>
  implements PriceRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payablePrice, clock);
  }

  override async create(data: NewPrice): Promise<Price> {
    assertCatalogTenantId(data.tenantId);
    return super.create(data);
  }

  override async findById(id: string, tenantId: string | null): Promise<Price | null> {
    assertCatalogTenantId(tenantId);
    return super.findById(id, tenantId);
  }

  override async update(id: string, patch: PricePatch, tenantId: string | null): Promise<Price> {
    assertCatalogTenantId(tenantId);
    return super.update(id, patch, tenantId);
  }

  async findByProviderId(
    provider: string,
    providerPriceId: string,
    tenantId: string | null,
  ): Promise<Price | null> {
    assertCatalogTenantId(tenantId);
    return this.firstWhere({
      provider,
      providerPriceId,
      ...this.tenantClause(tenantId),
    });
  }

  async listByProduct(productId: string, tenantId: string | null): Promise<Price[]> {
    assertCatalogTenantId(tenantId);
    return this.manyWhere({ productId, ...this.tenantClause(tenantId) });
  }

  protected toEntity(row: PrismaPriceRow): Price {
    return priceToEntity(row);
  }

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { id, tenantId };
  }

  protected override tenantClause(tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { tenantId };
  }

  protected toRow(data: Partial<NewPrice>): Record<string, unknown> {
    return priceToRow(data);
  }

  protected override toUpdateRow(data: Partial<NewPrice>): Record<string, unknown> {
    return pricePatchToRow(data);
  }
}
