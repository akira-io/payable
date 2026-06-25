import type { InvoicePdfDTO } from '../../domain/dtos/invoice.dto';
import { DownloadInvoicePdfAction } from '../actions/invoices/download-invoice-pdf.action';
import type { BillingDependencies } from './billing-dependencies';

export class InvoiceResource {
  constructor(private readonly deps: BillingDependencies) {}

  downloadPdf(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    return new DownloadInvoicePdfAction(this.deps).handle(providerInvoiceId);
  }
}
