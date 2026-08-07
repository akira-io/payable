import {
  isPauseSubscriptionCapable,
  type PauseSubscriptionCapable,
} from '../../../domain/contracts/pause-subscription-provider.contract';
import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { SubscriptionStateMachine } from '../../../domain/states/subscription-state-machine';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { assertSubscriptionOperation } from '../../services/provider-capabilities/assert-subscription-operation';
import { SubscriptionAction } from './subscription-action';

export class PauseSubscriptionAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanUpdateSubscriptionPolicy(),
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
      'pause subscription',
    );
    const provider = this.pauseProvider();
    const subscription = await this.resolve(billable, name);
    new SubscriptionStateMachine(subscription.status).pause();
    const providerSubscription = await provider.pauseSubscription(
      { providerSubscriptionId: subscription.providerSubscriptionId },
      this.context('pause', subscription.providerSubscriptionId),
    );
    return this.storage().transaction(async (repositories) => {
      const updated = await repositories.subscriptions.update(
        subscription.id,
        {
          status: this.reconcileStatus(subscription.status, providerSubscription.status),
        },
        this.deps.tenantId ?? null,
      );
      await this.auditWith(repositories, {
        action: 'subscription.paused',
        subscriptionId: subscription.id,
        before: { status: subscription.status },
        after: { status: updated.status },
        authorization,
      });
      return updated;
    });
  }

  private pauseProvider(): PaymentProvider & PauseSubscriptionCapable {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'subscriptions', isPauseSubscriptionCapable);
    assertSubscriptionOperation(provider, 'pause');
    return provider;
  }
}
