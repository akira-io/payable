import { isInvoiceCapable } from '../../../domain/contracts/payment-provider.contract';
import type { InvoiceDTO } from '../../../domain/dtos/invoice.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class ListInvoicesAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(billable: Billable, limit?: number): Promise<InvoiceDTO[]> {
    const provider = this.deps.provider;
    if (!isInvoiceCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'invoicePdf');
    }
    const storage = this.deps.storage;
    if (!storage) {
      return [];
    }
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      this.deps.tenantId ?? null,
    );
    if (!customer?.providerCustomerId) {
      return [];
    }
    return provider.listInvoices({
      providerCustomerId: customer.providerCustomerId,
      limit,
    });
  }
}
