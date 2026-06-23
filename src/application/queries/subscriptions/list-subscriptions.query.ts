import type { ListOptions } from '../../../domain/contracts/list-options.contract';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class ListSubscriptionsQuery {
  constructor(private readonly deps: BillingDependencies) {}

  async run(billable: Billable, options?: ListOptions): Promise<Subscription[]> {
    const { storage } = this.deps;
    if (!storage) {
      return [];
    }
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      this.deps.tenantId ?? null,
    );
    if (!customer) {
      return [];
    }
    return storage.subscriptions.listByCustomer(customer.id, options);
  }
}
