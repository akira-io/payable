import type Stripe from 'stripe';
import type { ResumeSubscriptionInput } from '../../../domain/contracts/payment-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import { toSubscriptionDTO } from './stripe-mappers';

export class StripeSubscriptions {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(input: CreateSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    const params: Stripe.SubscriptionCreateParams = {
      customer: input.providerCustomerId,
      items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],
    };
    if (input.trialDays !== undefined) {
      params.trial_period_days = input.trialDays;
    }
    if (input.coupon) {
      params.discounts = [{ coupon: input.coupon }];
    }
    const subscription = await stripe.subscriptions.create(params, {
      idempotencyKey: ctx.idempotencyKey,
    });
    return toSubscriptionDTO(subscription);
  }

  async update(input: UpdateSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    const params: Stripe.SubscriptionUpdateParams = {};
    if (input.priceId !== undefined || input.quantity !== undefined) {
      const current = await stripe.subscriptions.retrieve(input.providerSubscriptionId);
      params.items = [
        { id: current.items.data[0]?.id, price: input.priceId, quantity: input.quantity },
      ];
    }
    const subscription = await stripe.subscriptions.update(input.providerSubscriptionId, params, {
      idempotencyKey: ctx.idempotencyKey,
    });
    return toSubscriptionDTO(subscription);
  }

  async cancel(input: CancelSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    if (input.immediately) {
      const subscription = await stripe.subscriptions.cancel(
        input.providerSubscriptionId,
        undefined,
        {
          idempotencyKey: ctx.idempotencyKey,
        },
      );
      return toSubscriptionDTO(subscription);
    }
    const subscription = await stripe.subscriptions.update(
      input.providerSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return toSubscriptionDTO(subscription);
  }

  async resume(input: ResumeSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    const subscription = await stripe.subscriptions.update(
      input.providerSubscriptionId,
      { cancel_at_period_end: false },
      { idempotencyKey: ctx.idempotencyKey },
    );
    return toSubscriptionDTO(subscription);
  }
}
