import type { TenantScoped } from './common';

export interface InvoicePayment extends TenantScoped {
  readonly invoiceId: string;
  readonly paymentId: string;
  readonly createdAt: Date;
}
