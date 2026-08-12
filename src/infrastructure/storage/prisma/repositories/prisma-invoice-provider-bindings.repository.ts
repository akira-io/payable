import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  InvoiceProviderBindingRepository,
  NewInvoiceProviderBinding,
} from '../../../../domain/contracts/invoice-provider-binding-repository.contract';
import type { InvoiceProviderBinding } from '../../../../domain/entities/invoice-provider-binding.entity';
import type { PrismaClient } from '../prisma-client.types';
import type { PrismaInvoiceProviderBindingRow } from '../prisma-invoice-row.types';

export class PrismaInvoiceProviderBindingRepository implements InvoiceProviderBindingRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async create(binding: NewInvoiceProviderBinding): Promise<InvoiceProviderBinding> {
    const now = this.clock.now();
    const row = await this.client.payableInvoiceProviderBinding.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        tenantId: binding.tenantId,
        tenantKey: binding.tenantId ?? '',
        invoiceId: binding.invoiceId,
        provider: binding.provider,
        providerResourceType: binding.providerResourceType,
        providerResourceId: binding.providerResourceId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.toEntity(row);
  }

  async findByInvoiceAndProvider(invoiceId: string, provider: string, tenantId: string | null) {
    const row = await this.client.payableInvoiceProviderBinding.findFirst({
      where: { invoiceId, provider, tenantKey: tenantId ?? '' },
    });
    return row ? this.toEntity(row) : null;
  }

  async findByProviderResource(
    provider: string,
    providerResourceType: string,
    providerResourceId: string,
    tenantId: string | null,
  ) {
    const row = await this.client.payableInvoiceProviderBinding.findFirst({
      where: {
        provider,
        providerResourceType,
        providerResourceId,
        tenantKey: tenantId ?? '',
      },
    });
    return row ? this.toEntity(row) : null;
  }

  async listByInvoiceId(invoiceId: string, tenantId: string | null) {
    return this.listByInvoiceIds([invoiceId], tenantId);
  }

  async listByInvoiceIds(invoiceIds: string[], tenantId: string | null) {
    if (invoiceIds.length === 0) return [];
    const rows = await this.client.payableInvoiceProviderBinding.findMany({
      where: { invoiceId: { in: invoiceIds }, tenantKey: tenantId ?? '' },
      orderBy: [{ invoiceId: 'asc' }, { provider: 'asc' }],
    });
    return rows.map((row) => this.toEntity(row));
  }

  private toEntity(row: PrismaInvoiceProviderBindingRow): InvoiceProviderBinding {
    return {
      id: row.id,
      tenantId: row.tenantId,
      invoiceId: row.invoiceId,
      provider: row.provider,
      providerResourceType: row.providerResourceType,
      providerResourceId: row.providerResourceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
