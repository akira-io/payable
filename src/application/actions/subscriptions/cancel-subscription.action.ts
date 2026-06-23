import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanCancelSubscriptionPolicy } from '../../policies/can-cancel-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class CancelSubscriptionAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanCancelSubscriptionPolicy().authorize(context),
      authorization,
      'cancel subscription',
    );
    const subscription = await this.resolve(billable, name);
    const dto = await this.deps.provider.cancelSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId, immediately: false },
      this.context('cancel', subscription.providerSubscriptionId),
    );
    const updated = await this.storage().subscriptions.update(subscription.id, {
      status: dto.status,
      endsAt: dto.currentPeriodEnd,
    });
    await this.audit({
      action: 'subscription.canceled',
      subscriptionId: subscription.id,
      before: { status: subscription.status, endsAt: subscription.endsAt ?? null },
      after: { status: updated.status, endsAt: updated.endsAt ?? null },
      authorization,
    });
    return updated;
  }
}
