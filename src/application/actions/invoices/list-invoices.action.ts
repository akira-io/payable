import type { InvoiceDTO } from '../../../domain/dtos/invoice.dto';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

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
    return this.deps.provider.listInvoices({
      providerCustomerId: customer.providerCustomerId,
      limit,
    });
  }
}
