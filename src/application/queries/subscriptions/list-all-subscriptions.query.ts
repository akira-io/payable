import type { ListOptions } from '../../../domain/contracts/list-options.contract';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class ListAllSubscriptionsQuery {
  constructor(private readonly deps: BillingDependencies) {}

  run(options?: ListOptions): Promise<Subscription[]> {
    const storage = this.deps.storage;
    if (!storage) {
      return Promise.resolve([]);
    }
    return storage.subscriptions.list(this.deps.tenantId ?? null, options);
  }
}
