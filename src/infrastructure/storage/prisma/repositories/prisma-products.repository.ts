import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewProduct,
  ProductPatch,
  ProductRepository,
} from '../../../../domain/contracts/product-repository.contract';
import type { Product } from '../../../../domain/entities/product.entity';
import { assertCatalogTenantId, assertCatalogTenantIds } from '../../catalog-tenant';
import { productPatchToRow, productToEntity, productToRow } from '../mappers/product.mapper';
import { stripUndefined } from '../mappers/shared';
import type { PrismaClient, PrismaProductRow } from '../prisma-client.types';
import { PrismaRepository } from '../prisma-repository';

export class PrismaProductRepository
  extends PrismaRepository<Product, NewProduct, PrismaProductRow>
  implements ProductRepository
{
  constructor(client: PrismaClient, clock: Clock) {
    super(client.payableProduct, clock);
  }

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
    const updated = await this.delegate.updateMany({
      where: {
        ...this.scopedWhere(id, tenantId),
        ...productPatchToRow(expected),
      },
      data: stripUndefined({
        ...productPatchToRow(patch),
        updatedAt: this.clock.now(),
      }),
    });
    return updated.count > 0 ? this.findByIdOrFail(id, tenantId) : null;
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

  protected override scopedWhere(id: string, tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { id, tenantId };
  }

  protected override tenantClause(tenantId?: string | null): Record<string, unknown> {
    assertCatalogTenantId(tenantId);
    return { tenantId };
  }

  protected toRow(data: Partial<NewProduct>): Record<string, unknown> {
    return productToRow(data);
  }

  protected override toUpdateRow(data: Partial<NewProduct>): Record<string, unknown> {
    return productPatchToRow(data);
  }
}
