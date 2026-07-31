import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewPrice,
  PricePatch,
  PriceRepository,
} from '../../../../domain/contracts/price-repository.contract';
import type { Price } from '../../../../domain/entities/price.entity';
import { priceToEntity, priceToRow } from '../mappers/price.mapper';
import type { PrismaClient, PrismaPriceRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaPriceRepository
  extends PrismaRepository<Price, NewPrice, PrismaPriceRow>
  implements PriceRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payablePrice, clock);
  }

  override findById(id: string, tenantId: string | null): Promise<Price | null> {
    return super.findById(id, tenantId);
  }

  override update(id: string, patch: PricePatch, tenantId: string | null): Promise<Price> {
    return super.update(id, patch, tenantId);
  }

  findByProviderId(
    provider: string,
    providerPriceId: string,
    tenantId: string | null,
  ): Promise<Price | null> {
    return this.firstWhere({
      provider,
      providerPriceId,
      ...this.tenantClause(tenantId),
    });
  }

  listByProduct(productId: string, tenantId: string | null): Promise<Price[]> {
    return this.manyWhere({ productId, ...this.tenantClause(tenantId) });
  }

  protected toEntity(row: PrismaPriceRow): Price {
    return priceToEntity(row);
  }

  protected toRow(data: Partial<NewPrice>): Record<string, unknown> {
    return priceToRow(data);
  }
}
