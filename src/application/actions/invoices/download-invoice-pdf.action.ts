import type { InvoicePdfDTO } from '../../../domain/dtos/invoice.dto';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertProviderCapability } from '../../services/provider-capabilities/assert-provider-capability';

export class DownloadInvoicePdfAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    assertProviderCapability(this.deps.provider, 'invoicePdf');
    return this.deps.provider.downloadInvoicePdf(providerInvoiceId);
  }
}
