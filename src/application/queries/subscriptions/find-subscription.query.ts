import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class FindSubscriptionQuery {
  constructor(private readonly deps: BillingDependencies) {}

  async run(billable: Billable, name: string): Promise<Subscription | null> {
    const { storage } = this.deps;
    if (!storage) {
      return null;
    }
    const customer = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      this.deps.tenantId ?? null,
    );
    if (!customer) {
      return null;
    }
    return storage.subscriptions.findByName(customer.id, name);
  }
}
