import {
  isScheduledSubscriptionChangeCapable,
  type ScheduledSubscriptionChangeCapable,
} from '../../../domain/contracts/subscription-lifecycle-provider.contract';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { assertSubscriptionOperation } from '../../services/provider-capabilities/assert-subscription-operation';
import { SubscriptionAction } from './subscription-action';

export class CancelScheduledSubscriptionChangeAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanUpdateSubscriptionPolicy().authorize(context),
      authorization,
      'cancel scheduled subscription change',
    );
    const provider = this.deps.provider;
    assertCapableProvider<ScheduledSubscriptionChangeCapable>(
      provider,
      'subscriptions',
      isScheduledSubscriptionChangeCapable,
    );
    assertSubscriptionOperation(provider, 'cancelScheduledChange');
    const subscription = await this.resolve(billable, name);
    await this.assertNoActiveMigration(subscription.id);
    const context = this.context('cancel-scheduled-change', subscription.providerSubscriptionId);
    return this.mutateSubscription({
      subscriptionId: subscription.id,
      operation: 'subscription_cancel_scheduled_change',
      context,
      callProvider: async () => ({
        kind: 'applied',
        value: await provider.cancelScheduledSubscriptionChange(
          { providerSubscriptionId: subscription.providerSubscriptionId },
          context,
        ),
      }),
      persist: async (repos, dto) => {
        const updated = await repos.subscriptions.update(
          subscription.id,
          {
            ...this.lifecyclePatch(subscription, dto),
            scheduledChangeAction: null,
            scheduledChangeEffectiveAt: null,
            scheduledResumeAt: null,
            resumeBillingPolicy: null,
          },
          this.deps.tenantId ?? null,
        );
        await this.auditWith(repos, {
          action: 'subscription.scheduled_change_canceled',
          subscriptionId: subscription.id,
          before: this.lifecycleSnapshot(subscription),
          after: this.lifecycleSnapshot(updated),
          authorization,
        });
        return updated;
      },
    });
  }
}
