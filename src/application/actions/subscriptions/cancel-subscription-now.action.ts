import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanCancelSubscriptionPolicy } from '../../policies/can-cancel-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class CancelSubscriptionNowAction extends SubscriptionAction {
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
      { providerSubscriptionId: subscription.providerSubscriptionId, immediately: true },
      this.context('cancel-now', subscription.providerSubscriptionId),
    );
    const updated = await this.storage().subscriptions.update(
      subscription.id,
      {
        status: dto.status,
        endsAt: this.deps.clock.now(),
      },
      this.deps.tenantId ?? null,
    );
    await this.audit({
      action: 'subscription.canceled_now',
      subscriptionId: subscription.id,
      before: { status: subscription.status, endsAt: subscription.endsAt ?? null },
      after: { status: updated.status, endsAt: updated.endsAt ?? null },
      authorization,
    });
    return updated;
  }
}
