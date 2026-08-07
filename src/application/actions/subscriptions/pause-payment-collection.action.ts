import {
  isSubscriptionPaymentCollectionCapable,
  type SubscriptionPaymentCollectionCapable,
} from '../../../domain/contracts/subscription-lifecycle-provider.contract';
import {
  type PausePaymentCollectionPolicy,
  validatePausePaymentCollectionPolicy,
} from '../../../domain/dtos/subscription-pause-policy.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { assertPausePaymentCollectionPolicySupported } from '../../services/provider-capabilities/assert-subscription-operation';
import { SubscriptionAction } from './subscription-action';

export class PausePaymentCollectionAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    policy: PausePaymentCollectionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanUpdateSubscriptionPolicy().authorize(context),
      authorization,
      'pause payment collection',
    );
    validatePausePaymentCollectionPolicy(policy, this.deps.clock.now());
    const provider = this.deps.provider;
    assertCapableProvider<SubscriptionPaymentCollectionCapable>(
      provider,
      'subscriptions',
      isSubscriptionPaymentCollectionCapable,
    );
    assertPausePaymentCollectionPolicySupported(provider, policy);
    const subscription = await this.resolve(billable, name);
    const dto = await provider.pausePaymentCollection(
      { providerSubscriptionId: subscription.providerSubscriptionId, ...policy },
      this.context(
        'pause-payment-collection',
        subscription.providerSubscriptionId,
        JSON.stringify(policy),
      ),
    );
    return this.storage().transaction(async (repos) => {
      const updated = await repos.subscriptions.update(
        subscription.id,
        { ...this.lifecyclePatch(subscription, dto), status: subscription.status },
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repos, {
        action: 'subscription.payment_collection_paused',
        subscriptionId: subscription.id,
        before: this.lifecycleSnapshot(subscription),
        after: this.lifecycleSnapshot(updated),
        authorization,
      });
      return updated;
    });
  }
}
