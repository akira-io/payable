import type { Payment } from '../../domain/entities/payment.entity';
import { ChargeAction } from '../actions/payments/charge.action';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';
import type { ChargeRequest } from './charge-builder';
import { CheckoutBuilder } from './checkout-builder';
import { SubscriptionBuilder } from './subscription-builder';
import { SubscriptionManager } from './subscription-manager';

export class CustomerContext {
  constructor(
    private readonly billable: Billable,
    private readonly deps: BillingDependencies,
  ) {}

  newSubscription(name: string): SubscriptionBuilder {
    return new SubscriptionBuilder(name, this.billable, this.deps);
  }

  checkout(): CheckoutBuilder {
    return new CheckoutBuilder(this.billable, this.deps);
  }

  subscription(name: string): SubscriptionManager {
    return new SubscriptionManager(this.billable, name, this.deps);
  }

  charge(request: ChargeRequest): Promise<Payment> {
    return new ChargeAction(this.deps).handle({
      billable: this.billable,
      amount: request.amount,
      reference: request.reference,
      description: request.description,
    });
  }
}
