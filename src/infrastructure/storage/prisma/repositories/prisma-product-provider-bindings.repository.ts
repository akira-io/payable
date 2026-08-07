import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewProductProviderBinding,
  ProductProviderBindingRepository,
} from '../../../../domain/contracts/product-provider-binding-repository.contract';
import type { ProductProviderBinding } from '../../../../domain/entities/product-provider-binding.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import type { PrismaClient, PrismaProductProviderBindingRow } from '../prisma-client.types';

export class PrismaProductProviderBindingRepository implements ProductProviderBindingRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async create(binding: NewProductProviderBinding): Promise<ProductProviderBinding> {
    assertCatalogTenantId(binding.tenantId);
    const now = this.clock.now();
    const row = await this.client.payableProductProviderBinding.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        tenantId: binding.tenantId,
        tenantKey: binding.tenantId ?? '',
        productId: binding.productId,
        provider: binding.provider,
        providerProductId: binding.providerProductId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.toEntity(row);
  }

  findByProductAndProvider(
    productId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null> {
    return this.firstWhere({ productId, provider }, tenantId);
  }

  findByProviderId(
    provider: string,
    providerProductId: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null> {
    return this.firstWhere({ provider, providerProductId }, tenantId);
  }

  async listByProductId(
    productId: string,
    tenantId: string | null,
  ): Promise<ProductProviderBinding[]> {
    assertCatalogTenantId(tenantId);
    const rows = await this.client.payableProductProviderBinding.findMany({
      where: { productId, tenantKey: tenantId ?? '' },
      orderBy: { provider: 'asc' },
    });
    return rows.map((row) => this.toEntity(row));
  }

  private async firstWhere(
    where: Record<string, unknown>,
    tenantId: string | null,
  ): Promise<ProductProviderBinding | null> {
    assertCatalogTenantId(tenantId);
    const row = await this.client.payableProductProviderBinding.findFirst({
      where: { ...where, tenantKey: tenantId ?? '' },
    });
    return row ? this.toEntity(row) : null;
  }

  private toEntity(row: PrismaProductProviderBindingRow): ProductProviderBinding {
    return {
      id: row.id,
      tenantId: row.tenantId,
      productId: row.productId,
      provider: row.provider,
      providerProductId: row.providerProductId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
