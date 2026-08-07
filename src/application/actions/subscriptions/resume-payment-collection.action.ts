import {
  isSubscriptionPaymentCollectionCapable,
  type SubscriptionPaymentCollectionCapable,
} from '../../../domain/contracts/subscription-lifecycle-provider.contract';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import type { Billable } from '../../builders/billable';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanResumeSubscriptionPolicy } from '../../policies/can-resume-subscription.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { assertSubscriptionOperation } from '../../services/provider-capabilities/assert-subscription-operation';
import { SubscriptionAction } from './subscription-action';

export class ResumePaymentCollectionAction extends SubscriptionAction {
  async handle(
    billable: Billable,
    name: string,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    this.authorize(
      (context) => new CanResumeSubscriptionPolicy().authorize(context),
      authorization,
      'resume payment collection',
    );
    const provider = this.deps.provider;
    assertCapableProvider<SubscriptionPaymentCollectionCapable>(
      provider,
      'subscriptions',
      isSubscriptionPaymentCollectionCapable,
    );
    assertSubscriptionOperation(provider, 'resumePaymentCollection');
    const subscription = await this.resolve(billable, name);
    const dto = await provider.resumePaymentCollection(
      { providerSubscriptionId: subscription.providerSubscriptionId },
      this.context('resume-payment-collection', subscription.providerSubscriptionId),
    );
    return this.storage().transaction(async (repos) => {
      const updated = await repos.subscriptions.update(
        subscription.id,
        {
          ...this.lifecyclePatch(subscription, dto),
          status: subscription.status,
          paymentCollectionPauseBehavior: null,
          paymentCollectionResumesAt: null,
        },
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repos, {
        action: 'subscription.payment_collection_resumed',
        subscriptionId: subscription.id,
        before: this.lifecycleSnapshot(subscription),
        after: this.lifecycleSnapshot(updated),
        authorization,
      });
      return updated;
    });
  }
}
