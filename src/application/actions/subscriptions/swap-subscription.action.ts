import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class SwapSubscriptionAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanUpdateSubscriptionPolicy(),
  ) {
    super(deps);
  }

  async handle(
    billable: Billable,
    name: string,
    priceId: string,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize((context) => this.policy.authorize(context), authorization, 'swap subscription');
    const subscription = await this.resolve(billable, name);
    const dto = await this.subscriptionProvider().updateSubscription(
      {
        providerSubscriptionId: subscription.providerSubscriptionId,
        priceId,
        quantity: subscription.quantity,
      },
      this.context('swap', subscription.providerSubscriptionId, priceId, true),
    );
    return this.storage().transaction(async (repos) => {
      const updated = await repos.subscriptions.update(
        subscription.id,
        { priceId, status: this.reconcileStatus(subscription.status, dto.status) },
        this.deps.tenantId ?? null,
      );
      await repos.subscriptionItems.updatePrimary(
        subscription.id,
        { priceId },
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repos, {
        action: 'subscription.swapped',
        subscriptionId: subscription.id,
        before: { priceId: subscription.priceId, status: subscription.status },
        after: { priceId: updated.priceId, status: updated.status },
        authorization,
      });
      return updated;
    });
  }
}
