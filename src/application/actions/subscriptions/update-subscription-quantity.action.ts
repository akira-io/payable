import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class UpdateSubscriptionQuantityAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    quantity: number,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanUpdateSubscriptionPolicy().authorize(context),
      authorization,
      'update subscription quantity',
    );
    const subscription = await this.resolve(billable, name);
    const dto = await this.deps.provider.updateSubscription(
      {
        providerSubscriptionId: subscription.providerSubscriptionId,
        priceId: subscription.priceId ?? undefined,
        quantity,
      },
      this.context('quantity', subscription.providerSubscriptionId, String(quantity)),
    );
    return this.storage().transaction(async (repos) => {
      const updated = await repos.subscriptions.update(
        subscription.id,
        { quantity, status: dto.status },
        this.deps.tenantId ?? null,
      );
      await repos.subscriptionItems.updatePrimary(subscription.id, { quantity });
      await this.auditWith(repos, {
        action: 'subscription.quantity_updated',
        subscriptionId: subscription.id,
        before: { quantity: subscription.quantity, status: subscription.status },
        after: { quantity: updated.quantity, status: updated.status },
        authorization,
      });
      return updated;
    });
  }
}
