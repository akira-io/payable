import type { InvoiceProviderBinding } from '../entities/invoice-provider-binding.entity';

export type NewInvoiceProviderBinding = Omit<
  InvoiceProviderBinding,
  'id' | 'createdAt' | 'updatedAt'
>;

export interface InvoiceProviderBindingRepository {
  create(binding: NewInvoiceProviderBinding): Promise<InvoiceProviderBinding>;
  findByInvoiceAndProvider(
    invoiceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<InvoiceProviderBinding | null>;
  findByProviderResource(
    provider: string,
    providerResourceType: string,
    providerResourceId: string,
    tenantId: string | null,
  ): Promise<InvoiceProviderBinding | null>;
  listByInvoiceId(invoiceId: string, tenantId: string | null): Promise<InvoiceProviderBinding[]>;
  listByInvoiceIds(
    invoiceIds: string[],
    tenantId: string | null,
  ): Promise<InvoiceProviderBinding[]>;
}
