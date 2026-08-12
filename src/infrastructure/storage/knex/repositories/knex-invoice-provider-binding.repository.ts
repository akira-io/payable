import type { Knex } from 'knex';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  InvoiceProviderBindingRepository,
  NewInvoiceProviderBinding,
} from '../../../../domain/contracts/invoice-provider-binding-repository.contract';
import type { InvoiceProviderBinding } from '../../../../domain/entities/invoice-provider-binding.entity';

const TABLE = 'payable_invoice_provider_bindings';

export class KnexInvoiceProviderBindingRepository implements InvoiceProviderBindingRepository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(binding: NewInvoiceProviderBinding): Promise<InvoiceProviderBinding> {
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    await this.knex(TABLE).insert({
      id,
      tenant_id: binding.tenantId,
      tenant_key: binding.tenantId ?? '',
      invoice_id: binding.invoiceId,
      provider: binding.provider,
      provider_resource_type: binding.providerResourceType,
      provider_resource_id: binding.providerResourceId,
      created_at: timestamp,
      updated_at: timestamp,
    });
    return (await this.first({ id }, binding.tenantId)) as InvoiceProviderBinding;
  }

  findByInvoiceAndProvider(invoiceId: string, provider: string, tenantId: string | null) {
    return this.first({ invoice_id: invoiceId, provider }, tenantId);
  }

  findByProviderResource(
    provider: string,
    providerResourceType: string,
    providerResourceId: string,
    tenantId: string | null,
  ) {
    return this.first(
      {
        provider,
        provider_resource_type: providerResourceType,
        provider_resource_id: providerResourceId,
      },
      tenantId,
    );
  }

  async listByInvoiceId(invoiceId: string, tenantId: string | null) {
    return this.listByInvoiceIds([invoiceId], tenantId);
  }

  async listByInvoiceIds(invoiceIds: string[], tenantId: string | null) {
    if (invoiceIds.length === 0) return [];
    const rows = (await this.knex(TABLE)
      .where({ tenant_key: tenantId ?? '' })
      .whereIn('invoice_id', invoiceIds)
      .orderBy('provider', 'asc')) as Record<string, unknown>[];
    return rows.map((row) => this.toEntity(row));
  }

  private async first(query: Record<string, unknown>, tenantId: string | null) {
    const row = await this.knex(TABLE)
      .where({ ...query, tenant_key: tenantId ?? '' })
      .first();
    return row ? this.toEntity(row as Record<string, unknown>) : null;
  }

  private toEntity(row: Record<string, unknown>): InvoiceProviderBinding {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      invoiceId: row.invoice_id as string,
      provider: row.provider as string,
      providerResourceType: row.provider_resource_type as string,
      providerResourceId: row.provider_resource_id as string,
      createdAt: new Date(row.created_at as string | Date),
      updatedAt: new Date(row.updated_at as string | Date),
    };
  }
}
