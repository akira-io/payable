import { isInvoiceCapable } from '../../../domain/contracts/payment-provider.contract';
import type { InvoicePdfDTO } from '../../../domain/dtos/invoice.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class DownloadInvoicePdfAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(providerInvoiceId: string): Promise<InvoicePdfDTO> {
    const provider = this.deps.provider;
    if (!isInvoiceCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'invoicePdf');
    }
    const storage = this.deps.storage;
    if (!storage) {
      throw new PayableError('Invoice downloads require a storage driver', {
        code: 'INVOICE_STORAGE_REQUIRED',
      });
    }
    const tenantId = this.deps.tenantId ?? null;
    const invoice = await storage.invoices.findByProviderId(
      this.deps.providerName,
      providerInvoiceId,
      tenantId,
    );
    if (!invoice) {
      throw new PayableError(`Invoice not found: ${providerInvoiceId}`, {
        code: 'INVOICE_NOT_FOUND',
        context: { providerInvoiceId },
      });
    }
    return provider.downloadInvoicePdf(providerInvoiceId);
  }
}
