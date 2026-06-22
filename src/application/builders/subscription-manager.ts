import type { Subscription } from '../../domain/entities/subscription.entity';
import { CancelSubscriptionAction } from '../actions/subscriptions/cancel-subscription.action';
import { CancelSubscriptionNowAction } from '../actions/subscriptions/cancel-subscription-now.action';
import { ResumeSubscriptionAction } from '../actions/subscriptions/resume-subscription.action';
import { SwapSubscriptionAction } from '../actions/subscriptions/swap-subscription.action';
import { UpdateSubscriptionQuantityAction } from '../actions/subscriptions/update-subscription-quantity.action';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export class SubscriptionManager {
  constructor(
    private readonly billable: Billable,
    private readonly name: string,
    private readonly deps: BillingDependencies,
  ) {}

  swap(priceId: string): Promise<Subscription> {
    return new SwapSubscriptionAction(this.deps).handle(this.billable, this.name, priceId);
  }

  cancel(): Promise<Subscription> {
    return new CancelSubscriptionAction(this.deps).handle(this.billable, this.name);
  }

  cancelNow(): Promise<Subscription> {
    return new CancelSubscriptionNowAction(this.deps).handle(this.billable, this.name);
  }

  resume(): Promise<Subscription> {
    return new ResumeSubscriptionAction(this.deps).handle(this.billable, this.name);
  }

  updateQuantity(quantity: number): Promise<Subscription> {
    return new UpdateSubscriptionQuantityAction(this.deps).handle(
      this.billable,
      this.name,
      quantity,
    );
  }
}
