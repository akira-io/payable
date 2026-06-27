import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewProduct,
  ProductRepository,
} from '../../../../domain/contracts/product-repository.contract';
import type { Product } from '../../../../domain/entities/product.entity';
import { productToEntity, productToRow } from '../mappers/product.mapper';
import type { PrismaClient, PrismaProductRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaProductRepository
  extends PrismaRepository<Product, NewProduct, PrismaProductRow>
  implements ProductRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableProduct, clock);
  }

  findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId?: string | null,
  ): Promise<Product | null> {
    return this.firstWhere({
      provider,
      providerProductId,
      ...this.tenantClause(tenantId),
    });
  }

  protected toEntity(row: PrismaProductRow): Product {
    return productToEntity(row);
  }

  protected toRow(data: Partial<NewProduct>): Record<string, unknown> {
    return productToRow(data);
  }
}
