import type { CheckoutMode, CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import { PayableError } from '../../domain/errors/payable-error';
import { CreateCheckoutPipeline } from '../pipelines/checkout/create-checkout.pipeline';
import { assertAuthorized } from '../policies/assert-authorized';
import type { AuthorizationContext } from '../policies/authorization-context';
import { CanCreateCheckoutPolicy } from '../policies/can-create-checkout.policy';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export interface CheckoutRequest {
  successUrl: string;
  cancelUrl: string;
  reference?: string;
  authorization?: AuthorizationContext;
}

export class CheckoutBuilder {
  private readonly state: {
    mode: CheckoutMode;
    lineItems: { priceId: string; quantity: number }[];
    subscriptionName: string;
  } = { mode: 'payment', lineItems: [], subscriptionName: 'default' };

  constructor(
    private readonly billable: Billable,
    private readonly deps: BillingDependencies,
  ) {}

  mode(mode: CheckoutMode): this {
    this.state.mode = mode;
    return this;
  }

  addPrice(priceId: string, quantity = 1): this {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new PayableError(`Checkout quantity must be a positive integer, got ${quantity}`, {
        code: 'CHECKOUT_INVALID_QUANTITY',
        context: { quantity },
      });
    }
    this.state.lineItems.push({ priceId, quantity });
    return this;
  }

  async create(request: CheckoutRequest): Promise<CheckoutSessionDTO> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => new CanCreateCheckoutPolicy().authorize(context),
      request.authorization,
      'create checkout',
    );
    if (this.state.lineItems.length === 0) {
      throw new PayableError('Checkout requires at least one price', {
        code: 'CHECKOUT_LINE_ITEMS_REQUIRED',
      });
    }
    return new CreateCheckoutPipeline(this.deps).handle({
      billable: this.billable,
      mode: this.state.mode,
      lineItems: this.state.lineItems,
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
      subscriptionName: this.state.subscriptionName,
      reference: request.reference,
    });
  }
}
