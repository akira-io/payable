import type { TenantScoped, Timestamps } from './common';

export interface InvoiceProviderBinding extends TenantScoped, Timestamps {
  readonly id: string;
  readonly invoiceId: string;
  readonly provider: string;
  readonly providerResourceType: string;
  readonly providerResourceId: string;
}
