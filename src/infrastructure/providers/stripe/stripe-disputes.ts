import type Stripe from 'stripe';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { DisputeDTO, ListDisputesInput } from '../../../domain/dtos/dispute.dto';
import { withStripeErrors } from './stripe-errors';
import { toStripeDisputeDTO } from './stripe-mappers';

const DEFAULT_DISPUTE_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripeDisputes {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async list(input: ListDisputesInput = {}): Promise<DisputeDTO[]> {
    const stripe = await this.client();
    const limit = input.limit ?? DEFAULT_DISPUTE_LIMIT;
    const disputes = await withStripeErrors(() =>
      stripe.disputes
        .list({ limit: Math.min(limit, STRIPE_PAGE_LIMIT) })
        .autoPagingToArray({ limit }),
    );
    return disputes.map(toStripeDisputeDTO);
  }

  async retrieve(providerDisputeId: string): Promise<DisputeDTO> {
    const stripe = await this.client();
    const dispute = await withStripeErrors(() => stripe.disputes.retrieve(providerDisputeId));
    return toStripeDisputeDTO(dispute);
  }

  async accept(providerDisputeId: string, ctx: OperationContext): Promise<void> {
    const stripe = await this.client();
    await withStripeErrors(() =>
      stripe.disputes.close(providerDisputeId, {}, { idempotencyKey: ctx.idempotencyKey }),
    );
  }
}
