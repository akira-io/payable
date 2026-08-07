import type Stripe from 'stripe';
import type { ResumeSubscriptionInput } from '../../../domain/contracts/payment-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { requireSubscriptionChangePolicies } from '../../../domain/validation/subscription-change-policies';
import { withStripeErrors } from './stripe-errors';
import { toSubscriptionDTO } from './stripe-mappers';
import { stripePaymentFailurePolicy, stripeProrationPolicy } from './stripe-subscription-changes';

export class StripeSubscriptions {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(input: CreateSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    const items =
      input.items && input.items.length > 0
        ? input.items.map((item) => ({ price: item.priceId, quantity: item.quantity }))
        : [{ price: input.priceId, quantity: input.quantity ?? 1 }];
    const params: Stripe.SubscriptionCreateParams = {
      customer: input.providerCustomerId,
      items,
    };
    if (input.trialDays !== undefined) {
      params.trial_period_days = input.trialDays;
    }
    if (input.coupon) {
      params.discounts = [{ coupon: input.coupon }];
    }
    const subscription = await withStripeErrors(() =>
      stripe.subscriptions.create(params, { idempotencyKey: ctx.idempotencyKey }),
    );
    return toSubscriptionDTO(subscription);
  }

  async update(input: UpdateSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    const params: Stripe.SubscriptionUpdateParams = {};
    if (input.priceId !== undefined || input.quantity !== undefined) {
      if (!input.providerItemId) {
        throw new PayableError(
          `Stripe subscription ${input.providerSubscriptionId} has no mapped item to update`,
          { code: 'PROVIDER_SUBSCRIPTION_ITEM_MISSING' },
        );
      }
      params.items = [{ id: input.providerItemId, price: input.priceId, quantity: input.quantity }];
      const policies = requireSubscriptionChangePolicies(input);
      if (policies.effectiveTiming !== 'immediate') {
        throw new ProviderCapabilityNotSupportedError(
          'stripe',
          `subscriptions.change.${policies.effectiveTiming}`,
        );
      }
      params.proration_behavior = stripeProrationPolicy(policies.prorationPolicy);
      params.payment_behavior = stripePaymentFailurePolicy(policies.paymentFailurePolicy);
      if (policies.prorationPolicy !== 'none') {
        params.proration_date = Math.floor(policies.calculatedAt.getTime() / 1_000);
      }
    }
    const subscription = await withStripeErrors(() =>
      stripe.subscriptions.update(input.providerSubscriptionId, params, {
        idempotencyKey: ctx.idempotencyKey,
      }),
    );
    return toSubscriptionDTO(subscription);
  }

  async cancel(input: CancelSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    if (input.immediately) {
      const subscription = await withStripeErrors(() =>
        stripe.subscriptions.cancel(input.providerSubscriptionId, undefined, {
          idempotencyKey: ctx.idempotencyKey,
        }),
      );
      return toSubscriptionDTO(subscription);
    }
    const subscription = await withStripeErrors(() =>
      stripe.subscriptions.update(
        input.providerSubscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toSubscriptionDTO(subscription);
  }

  async resume(input: ResumeSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    const subscription = await withStripeErrors(() =>
      stripe.subscriptions.update(
        input.providerSubscriptionId,
        { cancel_at_period_end: false },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toSubscriptionDTO(subscription);
  }
}
