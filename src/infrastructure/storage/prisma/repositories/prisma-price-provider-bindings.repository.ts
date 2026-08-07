import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  NewPriceProviderBinding,
  PriceProviderBindingRepository,
} from '../../../../domain/contracts/price-provider-binding-repository.contract';
import type { PriceProviderBinding } from '../../../../domain/entities/price-provider-binding.entity';
import { assertCatalogTenantId } from '../../catalog-tenant';
import type { PrismaClient, PrismaPriceProviderBindingRow } from '../prisma-client.types';

export class PrismaPriceProviderBindingRepository implements PriceProviderBindingRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async create(binding: NewPriceProviderBinding): Promise<PriceProviderBinding> {
    assertCatalogTenantId(binding.tenantId);
    const now = this.clock.now();
    const row = await this.client.payablePriceProviderBinding.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        tenantId: binding.tenantId,
        tenantKey: binding.tenantId ?? '',
        priceId: binding.priceId,
        provider: binding.provider,
        providerPriceId: binding.providerPriceId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.toEntity(row);
  }

  findByPriceAndProvider(
    priceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null> {
    return this.firstWhere({ priceId, provider }, tenantId);
  }

  findByProviderId(
    provider: string,
    providerPriceId: string,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null> {
    return this.firstWhere({ provider, providerPriceId }, tenantId);
  }

  async listByPriceId(priceId: string, tenantId: string | null): Promise<PriceProviderBinding[]> {
    assertCatalogTenantId(tenantId);
    const rows = await this.client.payablePriceProviderBinding.findMany({
      where: { priceId, tenantKey: tenantId ?? '' },
      orderBy: { provider: 'asc' },
    });
    return rows.map((row) => this.toEntity(row));
  }

  private async firstWhere(
    where: Record<string, unknown>,
    tenantId: string | null,
  ): Promise<PriceProviderBinding | null> {
    assertCatalogTenantId(tenantId);
    const row = await this.client.payablePriceProviderBinding.findFirst({
      where: { ...where, tenantKey: tenantId ?? '' },
    });
    return row ? this.toEntity(row) : null;
  }

  private toEntity(row: PrismaPriceProviderBindingRow): PriceProviderBinding {
    return {
      id: row.id,
      tenantId: row.tenantId,
      priceId: row.priceId,
      provider: row.provider,
      providerPriceId: row.providerPriceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
