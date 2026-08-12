import type { CurrencyCode } from '../value-objects/currency';
import type { InvoiceStatus } from '../value-objects/invoice-status';
import type { TenantScoped, Timestamps } from './common';

export interface CanonicalInvoice extends TenantScoped, Timestamps {
  readonly id: string;
  readonly customerId: string;
  readonly subscriptionId: string | null;
  readonly status: InvoiceStatus;
  readonly currency: CurrencyCode;
  readonly total: number;
  readonly amountPaid: number;
  readonly amountDue: number;
  readonly number: string | null;
  readonly hostedInvoiceUrl: string | null;
  readonly invoicePdf: string | null;
}
