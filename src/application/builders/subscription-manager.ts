import type { Subscription } from '../../domain/entities/subscription.entity';
import { CancelSubscriptionAction } from '../actions/subscriptions/cancel-subscription.action';
import { CancelSubscriptionNowAction } from '../actions/subscriptions/cancel-subscription-now.action';
import { ResumeSubscriptionAction } from '../actions/subscriptions/resume-subscription.action';
import { SwapSubscriptionAction } from '../actions/subscriptions/swap-subscription.action';
import { UpdateSubscriptionQuantityAction } from '../actions/subscriptions/update-subscription-quantity.action';
import type { AuthorizationContext } from '../policies/authorization-context';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export class SubscriptionManager {
  constructor(
    private readonly billable: Billable,
    private readonly name: string,
    private readonly deps: BillingDependencies,
  ) {}

  swap(priceId: string, authorization?: AuthorizationContext): Promise<Subscription> {
    return new SwapSubscriptionAction(this.deps).handle(
      this.billable,
      this.name,
      priceId,
      authorization,
    );
  }

  cancel(authorization?: AuthorizationContext): Promise<Subscription> {
    return new CancelSubscriptionAction(this.deps).handle(this.billable, this.name, authorization);
  }

  cancelNow(authorization?: AuthorizationContext): Promise<Subscription> {
    return new CancelSubscriptionNowAction(this.deps).handle(
      this.billable,
      this.name,
      authorization,
    );
  }

  resume(authorization?: AuthorizationContext): Promise<Subscription> {
    return new ResumeSubscriptionAction(this.deps).handle(this.billable, this.name, authorization);
  }

  updateQuantity(quantity: number, authorization?: AuthorizationContext): Promise<Subscription> {
    return new UpdateSubscriptionQuantityAction(this.deps).handle(
      this.billable,
      this.name,
      quantity,
      authorization,
    );
  }
}
