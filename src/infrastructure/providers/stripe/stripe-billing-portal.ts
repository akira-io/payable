import type Stripe from 'stripe';
import type { BillingPortalDTO, BillingPortalInput } from '../../../domain/dtos/billing-portal.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { withStripeErrors } from './stripe-errors';

export class StripeBillingPortal {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(input: BillingPortalInput, ctx: OperationContext): Promise<BillingPortalDTO> {
    const stripe = await this.client();
    const session = await withStripeErrors(() =>
      stripe.billingPortal.sessions.create(
        { customer: input.providerCustomerId, return_url: input.returnUrl },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return { url: session.url };
  }
}
