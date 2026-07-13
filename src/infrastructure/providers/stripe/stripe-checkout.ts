import type Stripe from 'stripe';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { withStripeErrors } from './stripe-errors';
import { toCheckoutSessionDTO } from './stripe-mappers';

export class StripeCheckout {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    const stripe = await this.client();
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: input.providerCustomerId,
      mode: input.mode,
      line_items: input.lineItems.map((item) => ({ price: item.priceId, quantity: item.quantity })),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.reference,
    };
    if (input.mode === 'subscription' && input.trialDays !== undefined) {
      params.subscription_data = { trial_period_days: input.trialDays };
    }
    if (input.coupon) {
      params.discounts = [{ coupon: input.coupon }];
    }
    const session = await withStripeErrors(() =>
      stripe.checkout.sessions.create(params, { idempotencyKey: ctx.idempotencyKey }),
    );
    return toCheckoutSessionDTO(session);
  }
}
