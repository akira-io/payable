import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import { SubscriptionAction } from './subscription-action';

export class ResumeSubscriptionAction extends SubscriptionAction {
  async handle(billable: Billable, name: string): Promise<Subscription> {
    const subscription = await this.resolve(billable, name);
    const dto = await this.deps.provider.resumeSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId },
      this.context('resume', subscription.providerSubscriptionId),
    );
    return this.storage().subscriptions.update(subscription.id, {
      status: dto.status,
      endsAt: null,
    });
  }
}
