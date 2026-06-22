import type { CheckoutMode, CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import { PayableError } from '../../domain/errors/payable-error';
import { CreateCheckoutPipeline } from '../pipelines/checkout/create-checkout.pipeline';
import type { Billable } from './billable';
import type { BillingDependencies } from './billing-dependencies';

export interface CheckoutRequest {
  successUrl: string;
  cancelUrl: string;
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
    this.state.lineItems.push({ priceId, quantity });
    return this;
  }

  async create(request: CheckoutRequest): Promise<CheckoutSessionDTO> {
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
    });
  }
}
