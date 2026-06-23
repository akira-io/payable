import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import { SubscriptionAction } from './subscription-action';

export class SwapSubscriptionAction extends SubscriptionAction {
  async handle(billable: Billable, name: string, priceId: string): Promise<Subscription> {
    const subscription = await this.resolve(billable, name);
    const dto = await this.deps.provider.updateSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId, priceId },
      this.context('swap', subscription.providerSubscriptionId, priceId),
    );
    return this.storage().subscriptions.update(subscription.id, { priceId, status: dto.status });
  }
}
