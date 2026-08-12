import type { InvoicePayment } from '../entities/invoice-payment.entity';

export interface InvoicePaymentRepository {
  attach(relation: InvoicePayment): Promise<InvoicePayment>;
  detach(invoiceId: string, paymentId: string, tenantId: string | null): Promise<void>;
  listByInvoiceId(invoiceId: string, tenantId: string | null): Promise<InvoicePayment[]>;
  listByInvoiceIds(invoiceIds: string[], tenantId: string | null): Promise<InvoicePayment[]>;
}
