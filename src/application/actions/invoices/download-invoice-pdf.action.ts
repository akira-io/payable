import { isInvoiceCapable } from '../../../domain/contracts/payment-provider.contract';
import type { InvoicePdfDTO } from '../../../domain/dtos/invoice.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class DownloadInvoicePdfAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    const provider = this.deps.provider;
    if (!isInvoiceCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'invoicePdf');
    }
    return provider.downloadInvoicePdf(providerInvoiceId);
  }
}
