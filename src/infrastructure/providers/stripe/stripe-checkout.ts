import type Stripe from 'stripe';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeAmount } from './stripe-amounts';
import { withStripeErrors } from './stripe-errors';
import { toCheckoutSessionDTO } from './stripe-mappers';

function toLineItems(
  input: CreateCheckoutSessionInput,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (input.lineItems.length > 0) {
    return input.lineItems.map((item) => ({ price: item.priceId, quantity: item.quantity }));
  }
  if (input.amount && input.mode === 'payment') {
    return [
      {
        quantity: 1,
        price_data: {
          currency: input.amount.currency().toLowerCase(),
          unit_amount: stripeAmount(input.amount),
          product_data: { name: input.reference ?? 'Payment' },
        },
      },
    ];
  }
  throw new PayableError('Stripe checkout requires line items or a one-time payment amount', {
    code: 'CHECKOUT_LINE_ITEMS_REQUIRED',
    context: { mode: input.mode },
  });
}

export class StripeCheckout {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    const stripe = await this.client();
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: input.providerCustomerId || undefined,
      mode: input.mode,
      line_items: toLineItems(input),
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
