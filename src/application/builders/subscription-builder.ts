import type { CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import type { SubscriptionLineItem } from '../../domain/dtos/subscription.dto';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { PayableError } from '../../domain/errors/payable-error';
import { CreateSubscriptionAction } from '../actions/subscriptions/create-subscription.action';
import { CreateCheckoutPipeline } from '../pipelines/checkout/create-checkout.pipeline';
import { assertAuthorized } from '../policies/assert-authorized';
import type { AuthorizationContext } from '../policies/authorization-context';
import { CanCreateCheckoutPolicy } from '../policies/can-create-checkout.policy';
import { CanCreateSubscriptionPolicy } from '../policies/can-create-subscription.policy';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';
import type { CheckoutRequest } from './checkout-builder';

export class SubscriptionBuilder {
  private readonly state: {
    name: string;
    priceId?: string;
    trialDays?: number;
    quantity: number;
    coupon?: string;
    additionalItems: SubscriptionLineItem[];
  };

  constructor(
    name: string,
    private readonly billable: Billable,
    private readonly deps: BillingDependencies,
  ) {
    this.state = { name, quantity: 1, additionalItems: [] };
  }

  price(priceId: string): this {
    this.state.priceId = priceId;
    return this;
  }

  addItem(priceId: string, quantity = 1): this {
    this.state.additionalItems.push({ priceId, quantity });
    return this;
  }

  trialDays(days: number): this {
    this.state.trialDays = days;
    return this;
  }

  quantity(quantity: number): this {
    this.state.quantity = quantity;
    return this;
  }

  coupon(code: string): this {
    this.state.coupon = code;
    return this;
  }

  async checkout(request: CheckoutRequest): Promise<CheckoutSessionDTO> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => new CanCreateCheckoutPolicy().authorize(context),
      request.authorization,
      'create checkout',
    );
    if (!this.state.priceId) {
      throw new PayableError('A price is required before checkout', {
        code: 'CHECKOUT_PRICE_REQUIRED',
      });
    }
    return new CreateCheckoutPipeline(this.deps).handle({
      billable: this.billable,
      mode: 'subscription',
      lineItems: [{ priceId: this.state.priceId, quantity: this.state.quantity }],
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
      subscriptionName: this.state.name,
      trialDays: this.state.trialDays,
      coupon: this.state.coupon,
    });
  }

  async create(authorization?: AuthorizationContext): Promise<Subscription> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => new CanCreateSubscriptionPolicy().authorize(context),
      authorization,
      'create subscription',
    );
    if (!this.state.priceId) {
      throw new PayableError('A price is required before creating a subscription', {
        code: 'SUBSCRIPTION_PRICE_REQUIRED',
      });
    }
    const items =
      this.state.additionalItems.length > 0
        ? [
            { priceId: this.state.priceId, quantity: this.state.quantity },
            ...this.state.additionalItems,
          ]
        : undefined;
    return new CreateSubscriptionAction(this.deps).handle({
      billable: this.billable,
      name: this.state.name,
      priceId: this.state.priceId,
      quantity: this.state.quantity,
      items,
      trialDays: this.state.trialDays,
      coupon: this.state.coupon,
      authorization,
    });
  }
}
