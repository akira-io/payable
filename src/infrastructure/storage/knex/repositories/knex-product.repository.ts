import type {
  NewProduct,
  ProductRepository,
} from '../../../../domain/contracts/product-repository.contract';
import type { Product } from '../../../../domain/entities/product.entity';
import { KnexRepository } from '../knex-repository';
import { fromJson, toBool, toDate, toJson } from '../mappers';

export class KnexProductRepository
  extends KnexRepository<Product, NewProduct>
  implements ProductRepository
{
  protected readonly table = 'payable_products';

  findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId?: string | null,
  ): Promise<Product | null> {
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

  protected toRow(data: Partial<NewProduct>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      provider: data.provider,
      provider_product_id: data.providerProductId,
      name: data.name,
      description: data.description,
      active: data.active,
      metadata: data.metadata === undefined ? undefined : fromJson(data.metadata),
    };
  }
}
