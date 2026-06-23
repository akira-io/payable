import type { InvoiceDTO } from '../../../domain/dtos/invoice.dto';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertProviderCapability } from '../../services/provider-capabilities/assert-provider-capability';

export class ListInvoicesAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(billable: Billable, limit?: number): Promise<InvoiceDTO[]> {
    const storage = this.deps.storage;
    if (!storage) {
      return [];
    }
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
    );
    if (!customer?.providerCustomerId) {
      return [];
    }
    assertProviderCapability(this.deps.provider, 'invoicePdf');
    return this.deps.provider.listInvoices({
      providerCustomerId: customer.providerCustomerId,
      limit,
    });
  }
}
