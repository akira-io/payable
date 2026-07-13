import type Stripe from 'stripe';
import type { ChargeInput, ChargeResultDTO } from '../../../domain/dtos/charge.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import { stripeAmount } from './stripe-amounts';
import { withStripeErrors } from './stripe-errors';
import { toChargeResultDTO, toRefundResultDTO } from './stripe-mappers';

const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

function stripeRefundReason(reason?: string): Stripe.RefundCreateParams.Reason | undefined {
  return reason && STRIPE_REFUND_REASONS.has(reason)
    ? (reason as Stripe.RefundCreateParams.Reason)
    : undefined;
}

export class StripePayments {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async charge(input: ChargeInput, ctx: OperationContext): Promise<ChargeResultDTO> {
    const stripe = await this.client();
    const intent = await withStripeErrors(() =>
      stripe.paymentIntents.create(
        {
          amount: stripeAmount(input.amount),
          currency: input.amount.currency().toLowerCase(),
          customer: input.providerCustomerId,
          description: input.description,
          metadata: input.reference ? { reference: input.reference } : undefined,
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toChargeResultDTO(intent);
  }

  async refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO> {
    const stripe = await this.client();
    const refund = await withStripeErrors(() =>
      stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: input.amount ? stripeAmount(input.amount) : undefined,
          reason: stripeRefundReason(input.reason),
          metadata: input.reference ? { reference: input.reference } : undefined,
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toRefundResultDTO(refund);
  }
}
