import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanCancelSubscriptionPolicy } from '../../policies/can-cancel-subscription.policy';
import { SubscriptionAction } from './subscription-action';

export class CancelSubscriptionNowAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanCancelSubscriptionPolicy(),
  ) {
    super(deps);
  }

  async handle(
    billable: Billable,
    name: string,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => this.policy.authorize(context),
      authorization,
      'cancel subscription',
    );
    const provider = this.subscriptionProvider('cancelImmediately');
    const subscription = await this.resolve(billable, name);
    await this.assertNoActiveMigration(subscription.id);
    const context = this.context('cancel-now', subscription.providerSubscriptionId);
    return this.mutateSubscription({
      subscriptionId: subscription.id,
      operation: 'subscription_cancel_now',
      context,
      callProvider: async () => ({
        kind: 'applied',
        value: await provider.cancelSubscription(
          { providerSubscriptionId: subscription.providerSubscriptionId, immediately: true },
          context,
        ),
      }),
      persist: async (repos, dto) => {
        const updated = await repos.subscriptions.update(
          subscription.id,
          {
            status: this.reconcileStatus(subscription.status, dto.status),
            endsAt: this.deps.clock.now(),
          },
          this.deps.tenantId ?? null,
        );
        await this.auditWith(repos, {
          action: 'subscription.canceled_now',
          subscriptionId: subscription.id,
          before: { status: subscription.status, endsAt: subscription.endsAt ?? null },
          after: { status: updated.status, endsAt: updated.endsAt ?? null },
          authorization,
        });
        return updated;
      },
    });
  }
}
