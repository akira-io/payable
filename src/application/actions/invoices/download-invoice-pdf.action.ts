import { isInvoiceCapable } from '../../../domain/contracts/payment-provider.contract';
import type { InvoicePdfDTO } from '../../../domain/dtos/invoice.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';

export class DownloadInvoicePdfAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(providerInvoiceId: string, billable?: Billable): Promise<InvoicePdfDTO> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'invoicePdf', isInvoiceCapable);
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
    if (!invoice || !(await this.belongsToBillable(invoice.customerId, tenantId, billable))) {
      throw new PayableError(`Invoice not found: ${providerInvoiceId}`, {
        code: 'INVOICE_NOT_FOUND',
        context: { providerInvoiceId },
      });
    }
    return provider.downloadInvoicePdf(providerInvoiceId);
  }

  private async belongsToBillable(
    customerId: string,
    tenantId: string | null,
    billable?: Billable,
  ): Promise<boolean> {
    if (!billable) {
      return false;
    }
    const customer = await this.deps.storage?.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    return customer?.id === customerId;
  }
}
