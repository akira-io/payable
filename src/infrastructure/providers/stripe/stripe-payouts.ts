import type Stripe from 'stripe';
import type { ListPayoutsInput, PayoutDTO } from '../../../domain/dtos/payout.dto';
import { withStripeErrors } from './stripe-errors';
import { toStripePayoutDTO } from './stripe-mappers';

const DEFAULT_PAYOUT_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripePayouts {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async list(input: ListPayoutsInput = {}): Promise<PayoutDTO[]> {
    const stripe = await this.client();
    const limit = input.limit ?? DEFAULT_PAYOUT_LIMIT;
    const payouts = await withStripeErrors(() =>
      stripe.payouts
        .list({ limit: Math.min(limit, STRIPE_PAGE_LIMIT) })
        .autoPagingToArray({ limit }),
    );
    return payouts.map(toStripePayoutDTO);
  }

  async retrieve(providerPayoutId: string): Promise<PayoutDTO> {
    const stripe = await this.client();
    const payout = await withStripeErrors(() => stripe.payouts.retrieve(providerPayoutId));
    return toStripePayoutDTO(payout);
  }
}
