import type Stripe from 'stripe';
import type { ChargeResultDTO } from '../../../domain/dtos/charge.dto';
import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { CustomerDTO } from '../../../domain/dtos/customer.dto';
import type { DisputeDTO } from '../../../domain/dtos/dispute.dto';
import type { InvoiceDTO } from '../../../domain/dtos/invoice.dto';
import type { PaymentMethodDTO } from '../../../domain/dtos/payment-method.dto';
import type { PayoutDTO, PayoutStatus } from '../../../domain/dtos/payout.dto';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { ProviderWebhookEndpointDTO } from '../../../domain/dtos/provider-webhook-endpoint.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { RecurringInterval } from '../../../domain/entities/common';
import { PayableError } from '../../../domain/errors/payable-error';
import { isInvoiceStatus } from '../../../domain/value-objects/invoice-status';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import { isSubscriptionStatus } from '../../../domain/value-objects/subscription-status';
import { stripeMoney } from './stripe-amounts';
import {
  stripeSubscriptionItems,
  stripeWebhookSubscriptionItems,
} from './stripe-subscription-item-mappers';

const PAYMENT_STATUS = {
  succeeded: 'succeeded',
  processing: 'processing',
  canceled: 'canceled',
  requires_payment_method: 'pending',
  requires_confirmation: 'pending',
  requires_action: 'pending',
  requires_capture: 'authorized',
} satisfies Record<Stripe.PaymentIntent.Status, PaymentStatus>;

const REFUND_STATUS: Record<string, RefundStatus> = {
  succeeded: 'succeeded',
  pending: 'pending',
  failed: 'failed',
  canceled: 'canceled',
  requires_action: 'pending',
};

const PAYOUT_STATUS: Record<string, PayoutStatus> = {
  pending: 'pending',
  in_transit: 'in_transit',
  paid: 'paid',
  failed: 'failed',
  canceled: 'canceled',
};

function fromUnixSeconds(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value * 1000);
}

function resolvePriceUnitAmount(price: Stripe.Price): number {
  if (price.unit_amount !== null && price.unit_amount !== undefined) {
    return price.unit_amount;
  }
  if (price.unit_amount_decimal !== null && price.unit_amount_decimal !== undefined) {
    const parsed = Number(price.unit_amount_decimal);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
    if (Number.isFinite(parsed)) {
      throw new PayableError(
        `Stripe price ${price.id} has a fractional unit amount ${price.unit_amount_decimal} that cannot be represented in integer minor units`,
        {
          code: 'PROVIDER_PRICE_AMOUNT_FRACTIONAL',
          context: { priceId: price.id, unitAmountDecimal: price.unit_amount_decimal },
        },
      );
    }
  }
  throw new PayableError(`Stripe price ${price.id} has no resolvable unit amount`, {
    code: 'PROVIDER_PRICE_AMOUNT_UNRESOLVABLE',
    context: { priceId: price.id },
  });
}

export function toCustomerDTO(customer: Stripe.Customer): CustomerDTO {
  return {
    providerCustomerId: customer.id,
    email: customer.email ?? null,
    name: customer.name ?? null,
  };
}

export function toStripePaymentMethodDTO(
  method: Stripe.PaymentMethod,
  providerCustomerId: string,
): PaymentMethodDTO {
  return {
    providerPaymentMethodId: method.id,
    providerCustomerId,
    type: method.type,
    brand: method.card?.brand ?? null,
    last4: method.card?.last4 ?? null,
    expiresMonth: method.card?.exp_month ?? null,
    expiresYear: method.card?.exp_year ?? null,
  };
}

export function toStripeDisputeDTO(dispute: Stripe.Dispute): DisputeDTO {
  return {
    providerDisputeId: dispute.id,
    providerPaymentId: stripeResourceId(dispute.payment_intent) ?? stripeResourceId(dispute.charge),
    status: dispute.status,
    reason: dispute.reason ?? null,
    amount: stripeMoney(dispute.amount, dispute.currency),
    responseDueAt: fromUnixSeconds(dispute.evidence_details?.due_by),
    createdAt: fromUnixSeconds(dispute.created),
  };
}

export function toStripePayoutDTO(payout: Stripe.Payout): PayoutDTO {
  return {
    providerPayoutId: payout.id,
    status: PAYOUT_STATUS[payout.status] ?? 'pending',
    amount: stripeMoney(payout.amount, payout.currency),
    createdAt: fromUnixSeconds(payout.created),
    arrivalAt: fromUnixSeconds(payout.arrival_date),
  };
}

export function toStripeWebhookEndpointDTO(
  endpoint: Stripe.WebhookEndpoint,
): ProviderWebhookEndpointDTO {
  const status =
    endpoint.status === 'enabled' || endpoint.status === 'disabled' ? endpoint.status : null;
  return {
    providerWebhookEndpointId: endpoint.id,
    url: endpoint.url,
    events: endpoint.enabled_events,
    signingSecret: endpoint.secret ?? null,
    status,
  };
}

function stripeResourceId(resource: { id: string } | string | null | undefined): string | null {
  if (!resource) {
    return null;
  }
  return typeof resource === 'string' ? resource : resource.id;
}

export function toProductDTO(product: Stripe.Product): ProductDTO {
  return {
    providerProductId: product.id,
    name: product.name,
    description: product.description,
    active: product.active,
    metadata: product.metadata,
    ...(typeof product.updated === 'number' ? { providerVersion: String(product.updated) } : {}),
  };
}

export function toPriceDTO(price: Stripe.Price): PriceDTO {
  return {
    providerPriceId: price.id,
    providerProductId: typeof price.product === 'string' ? price.product : price.product.id,
    unitAmount: stripeMoney(resolvePriceUnitAmount(price), price.currency),
    interval: (price.recurring?.interval as RecurringInterval | undefined) ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
    description: price.nickname,
    active: price.active,
    lookupKey: stripePriceLookupKey(price),
    ...(typeof price.created === 'number' ? { providerVersion: String(price.created) } : {}),
  };
}

function stripePriceLookupKey(price: Stripe.Price): string | null {
  const lookupKey = (price as { lookup_key?: unknown }).lookup_key;
  if (lookupKey === null || lookupKey === undefined) {
    return null;
  }
  if (typeof lookupKey === 'string') {
    return lookupKey;
  }
  throw new PayableError('Stripe price response does not contain the requested lookup key', {
    code: 'PROVIDER_RESPONSE_INVALID',
    context: { provider: 'stripe', field: 'lookup_key', providerPriceId: price.id },
  });
}

export function toCheckoutSessionDTO(session: Stripe.Checkout.Session): CheckoutSessionDTO {
  if (!session.url) {
    throw new PayableError('Stripe checkout session is missing a redirect url', {
      code: 'PROVIDER_STRIPE_CHECKOUT_URL_MISSING',
      context: { provider: 'stripe', sessionId: session.id },
    });
  }
  return {
    id: session.id,
    url: session.url,
  };
}

export function toSubscriptionDTO(subscription: Stripe.Subscription): SubscriptionDTO {
  const pauseCollection = subscription.pause_collection;
  return {
    providerSubscriptionId: subscription.id,
    status: isSubscriptionStatus(subscription.status) ? subscription.status : 'incomplete',
    currentPeriodEnd: fromUnixSeconds(earliestPeriodEnd(subscription)),
    trialEndsAt: fromUnixSeconds(subscription.trial_end),
    paymentCollectionPauseBehavior: stripePauseBehavior(pauseCollection?.behavior),
    paymentCollectionResumesAt: fromUnixSeconds(pauseCollection?.resumes_at),
    items: stripeSubscriptionItems(subscription),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function toSubscriptionDTOFromWebhook(data: Record<string, unknown>): SubscriptionDTO {
  const status =
    typeof data.status === 'string' && isSubscriptionStatus(data.status)
      ? data.status
      : 'incomplete';
  const rawItems = (data.items as { data?: unknown } | undefined)?.data;
  const ends = (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => (item as { current_period_end?: unknown }).current_period_end)
    .filter((end): end is number => typeof end === 'number');
  const periodEnd = ends.length > 0 ? Math.min(...ends) : numberOrNull(data.current_period_end);
  const pauseCollection =
    typeof data.pause_collection === 'object' && data.pause_collection !== null
      ? (data.pause_collection as Record<string, unknown>)
      : null;
  return {
    providerSubscriptionId: String(data.id ?? ''),
    status,
    currentPeriodEnd: fromUnixSeconds(periodEnd),
    trialEndsAt: fromUnixSeconds(numberOrNull(data.trial_end)),
    paymentCollectionPauseBehavior: stripePauseBehavior(pauseCollection?.behavior),
    paymentCollectionResumesAt: fromUnixSeconds(numberOrNull(pauseCollection?.resumes_at)),
    items: stripeWebhookSubscriptionItems(rawItems),
  };
}

function stripePauseBehavior(value: unknown) {
  switch (value) {
    case 'keep_as_draft':
      return 'keepAsDraft' as const;
    case 'mark_uncollectible':
      return 'markUncollectible' as const;
    case 'void':
      return 'void' as const;
    default:
      return null;
  }
}

function earliestPeriodEnd(subscription: Stripe.Subscription): number | null | undefined {
  const ends = (subscription.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((end): end is number => typeof end === 'number');
  if (ends.length === 0) {
    return (subscription as { current_period_end?: number | null }).current_period_end;
  }
  return Math.min(...ends);
}

export function toChargeResultDTO(intent: Stripe.PaymentIntent): ChargeResultDTO {
  return {
    providerPaymentId: intent.id,
    status: PAYMENT_STATUS[intent.status] ?? 'pending',
    amount: stripeMoney(intent.amount, intent.currency),
  };
}

export function toRefundResultDTO(refund: Stripe.Refund): RefundResultDTO {
  return {
    providerRefundId: refund.id,
    status: refund.status ? (REFUND_STATUS[refund.status] ?? 'pending') : 'pending',
    amount: stripeMoney(refund.amount, refund.currency),
  };
}

export function toInvoiceDTO(invoice: Stripe.Invoice): InvoiceDTO {
  return {
    providerInvoiceId: invoice.id ?? '',
    status: invoice.status && isInvoiceStatus(invoice.status) ? invoice.status : 'draft',
    total: stripeMoney(invoice.total ?? 0, invoice.currency),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
  };
}
