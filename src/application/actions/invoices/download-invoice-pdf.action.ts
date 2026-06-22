import type { InvoicePdfDTO } from '../../../domain/dtos/invoice.dto';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class DownloadInvoicePdfAction {
  constructor(private readonly deps: BillingDependencies) {}

  handle(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    return this.deps.provider.downloadInvoicePdf(providerInvoiceId);
  }
}
