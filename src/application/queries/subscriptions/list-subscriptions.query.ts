import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class ListSubscriptionsQuery {
  constructor(private readonly deps: BillingDependencies) {}

  async run(billable: Billable): Promise<Subscription[]> {
    const { storage } = this.deps;
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
    return storage.subscriptions.listByCustomer(customer.id);
  }
}
