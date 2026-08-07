import type Stripe from 'stripe';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type {
  ProviderSubscriptionChangeInput,
  ProviderSubscriptionChangePreview,
} from '../../../domain/dtos/subscription-change.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { withStripeErrors } from './stripe-errors';
import { toSubscriptionDTO } from './stripe-mappers';

export class StripeSubscriptionChanges {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async preview(
    input: ProviderSubscriptionChangeInput,
    _context: OperationContext,
  ): Promise<ProviderSubscriptionChangePreview> {
    const stripe = await this.client();
    const invoice = await withStripeErrors(() =>
      stripe.invoices.createPreview({
        subscription: input.providerSubscriptionId,
        subscription_details: this.previewDetails(input),
      }),
    );
    const currency = invoice.currency.toUpperCase();
    const prorationAmount = invoice.lines.data.reduce((total, line) => {
      const details = line.parent?.subscription_item_details;
      return details?.proration ? total + line.amount : total;
    }, 0);
    return {
      immediateAdjustment: {
        direction: moneyDirection(prorationAmount),
        amount: Math.abs(prorationAmount),
        currency,
      },
      nextRenewal: {
        amount: invoice.amount_due,
        date: invoice.period_end === null ? null : new Date(invoice.period_end * 1_000),
        currency,
      },
      warnings: [],
      providerLimitations: [],
    };
  }

  async apply(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<SubscriptionDTO> {
    const stripe = await this.client();
    const subscription = await withStripeErrors(() =>
      stripe.subscriptions.update(
        input.providerSubscriptionId,
        {
          items: this.items(input),
          proration_behavior: stripeProrationPolicy(input.prorationPolicy),
          ...(input.prorationPolicy === 'none'
            ? {}
            : { proration_date: Math.floor(input.calculatedAt.getTime() / 1_000) }),
          payment_behavior: stripePaymentFailurePolicy(input.paymentFailurePolicy),
        },
        { idempotencyKey: context.idempotencyKey },
      ),
    );
    return toSubscriptionDTO(subscription);
  }

  private previewDetails(
    input: ProviderSubscriptionChangeInput,
  ): Stripe.InvoiceCreatePreviewParams.SubscriptionDetails {
    const prorationBehavior = stripeProrationPolicy(input.prorationPolicy);
    return {
      items: this.items(input),
      proration_behavior: prorationBehavior,
      ...(prorationBehavior === 'none'
        ? {}
        : { proration_date: Math.floor(input.calculatedAt.getTime() / 1_000) }),
    };
  }

  private items(input: ProviderSubscriptionChangeInput) {
    return input.proposedItems.map((subscriptionItem) => {
      if (!subscriptionItem.providerItemId) {
        throw new ProviderCapabilityNotSupportedError(
          'stripe',
          'subscriptions.change.stable-item-identity',
        );
      }
      return {
        id: subscriptionItem.providerItemId,
        price: subscriptionItem.priceId,
        quantity: subscriptionItem.quantity,
      };
    });
  }
}

export function stripeProrationPolicy(
  policy: ProviderSubscriptionChangeInput['prorationPolicy'],
): Stripe.SubscriptionUpdateParams.ProrationBehavior {
  if (policy === 'prorateImmediately') {
    return 'always_invoice';
  }
  if (policy === 'prorateAtNextRenewal') {
    return 'create_prorations';
  }
  if (policy === 'none') {
    return 'none';
  }
  throw new ProviderCapabilityNotSupportedError('stripe', `subscriptions.change.${policy}`);
}

export function stripePaymentFailurePolicy(
  policy: ProviderSubscriptionChangeInput['paymentFailurePolicy'],
): Stripe.SubscriptionUpdateParams.PaymentBehavior {
  return policy === 'preventChange' ? 'error_if_incomplete' : 'allow_incomplete';
}

function moneyDirection(amount: number): 'charge' | 'credit' | 'none' {
  if (amount > 0) {
    return 'charge';
  }
  if (amount < 0) {
    return 'credit';
  }
  return 'none';
}
