import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewProduct,
  ProductPatch,
  ProductRepository,
} from '../../../../domain/contracts/product-repository.contract';
import type { Product } from '../../../../domain/entities/product.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import { productPatchToRow, productToEntity, productToRow } from '../mappers/product.mapper';
import type { PrismaClient, PrismaProductRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaProductRepository
  extends PrismaRepository<Product, NewProduct, PrismaProductRow>
  implements ProductRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableProduct, clock);
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

  async findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId: string | null,
  ): Promise<Product | null> {
    assertCatalogTenantId(tenantId);
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

  protected override toUpdateRow(data: Partial<NewProduct>): Record<string, unknown> {
    return productPatchToRow(data);
  }
}
