import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import { SubscriptionAction } from './subscription-action';

export class UpdateSubscriptionQuantityAction extends SubscriptionAction {
  async handle(billable: Billable, name: string, quantity: number): Promise<Subscription> {
    const subscription = await this.resolve(billable, name);
    const dto = await this.deps.provider.updateSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId, quantity },
      this.context('quantity', subscription.providerSubscriptionId),
    );
    const updated = await this.storage().subscriptions.update(subscription.id, {
      quantity,
      status: dto.status,
    });
    await this.storage().subscriptionItems.updatePrimary(subscription.id, { quantity });
    return updated;
  }
}
