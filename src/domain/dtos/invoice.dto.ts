import type { InvoiceStatus } from '../value-objects/invoice-status';
import type { Money } from '../value-objects/money';

export interface ListInvoicesInput {
  providerCustomerId: string;
  limit?: number;
}

export interface InvoiceDTO {
  providerInvoiceId: string;
  status: InvoiceStatus;
  total: Money;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface InvoicePdfDTO {
  filename: string;
  content: Uint8Array;
}
