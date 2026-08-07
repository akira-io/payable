import {
  isSubscriptionPauseCapable,
  type SubscriptionPauseCapable,
} from '../../../domain/contracts/subscription-lifecycle-provider.contract';
import type { PauseSubscriptionPolicy } from '../../../domain/dtos/subscription-pause-policy.dto';
import {
  validatePauseSubscriptionPolicy,
  validatePauseSubscriptionResumeBoundary,
} from '../../../domain/dtos/subscription-pause-policy.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { SubscriptionStateMachine } from '../../../domain/states/subscription-state-machine';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { assertPauseSubscriptionPolicySupported } from '../../services/provider-capabilities/assert-subscription-operation';
import { SubscriptionAction } from './subscription-action';

export class PauseSubscriptionAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    policy: PauseSubscriptionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanUpdateSubscriptionPolicy().authorize(context),
      authorization,
      'pause subscription',
    );
    validatePauseSubscriptionPolicy(policy, this.deps.clock.now());
    const provider = this.deps.provider;
    assertCapableProvider<SubscriptionPauseCapable>(
      provider,
      'subscriptions',
      isSubscriptionPauseCapable,
    );
    assertPauseSubscriptionPolicySupported(provider, policy);
    const subscription = await this.resolve(billable, name);
    validatePauseSubscriptionResumeBoundary(policy, subscription.currentPeriodEnd);
    new SubscriptionStateMachine(subscription.status).pause();
    const dto = await provider.pauseSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId, ...policy },
      this.context('pause', subscription.providerSubscriptionId, JSON.stringify(policy)),
    );
    return this.storage().transaction(async (repos) => {
      const updated = await repos.subscriptions.update(
        subscription.id,
        this.lifecyclePatch(subscription, dto),
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repos, {
        action:
          dto.scheduledChangeAction === 'pause'
            ? 'subscription.pause_scheduled'
            : 'subscription.paused',
        subscriptionId: subscription.id,
        before: this.lifecycleSnapshot(subscription),
        after: this.lifecycleSnapshot(updated),
        authorization,
      });
      return updated;
    });
  }
}
