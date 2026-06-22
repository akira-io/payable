import type { Payment } from '../../../domain/entities/payment.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class ListPaymentsQuery {
  constructor(private readonly deps: BillingDependencies) {}

  async run(billable: Billable, limit?: number): Promise<Payment[]> {
    const storage = this.deps.storage;
    if (!storage) {
      return [];
    }
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
    );
    if (!customer) {
      return [];
    }
    return storage.payments.listByCustomer(customer.id, limit);
  }
}
