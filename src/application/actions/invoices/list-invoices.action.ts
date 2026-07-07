import { isInvoiceCapable } from '../../../domain/contracts/payment-provider.contract';
import type { InvoiceDTO } from '../../../domain/dtos/invoice.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';

export class ListInvoicesAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(billable: Billable, limit?: number): Promise<InvoiceDTO[]> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new PayableError(`Invoice limit must be a positive integer, got ${limit}`, {
        code: 'INVOICE_LIMIT_INVALID',
      });
    }
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'invoicePdf', isInvoiceCapable);
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
