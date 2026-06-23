import type Stripe from 'stripe';
import type { ChargeResultDTO } from '../../../domain/dtos/charge.dto';
import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { CustomerDTO } from '../../../domain/dtos/customer.dto';
import type { InvoiceDTO } from '../../../domain/dtos/invoice.dto';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { RecurringInterval } from '../../../domain/entities/common';
import { PayableError } from '../../../domain/errors/payable-error';
import type { InvoiceStatus } from '../../../domain/value-objects/invoice-status';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import { isSubscriptionStatus } from '../../../domain/value-objects/subscription-status';
import { stripeMoney } from './stripe-amounts';

const PAYMENT_STATUS: Record<string, PaymentStatus> = {
  succeeded: 'succeeded',
  processing: 'processing',
  canceled: 'canceled',
  requires_payment_method: 'pending',
  requires_confirmation: 'pending',
  requires_action: 'pending',
  requires_capture: 'pending',
};

const REFUND_STATUS: Record<string, RefundStatus> = {
  succeeded: 'succeeded',
  pending: 'pending',
  failed: 'failed',
  canceled: 'canceled',
  requires_action: 'pending',
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
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
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

export function toProductDTO(product: Stripe.Product): ProductDTO {
  return {
    providerProductId: product.id,
    name: product.name,
    active: product.active,
  };
}

export function toPriceDTO(price: Stripe.Price): PriceDTO {
  return {
    providerPriceId: price.id,
    providerProductId: typeof price.product === 'string' ? price.product : price.product.id,
    unitAmount: stripeMoney(resolvePriceUnitAmount(price), price.currency),
    interval: (price.recurring?.interval as RecurringInterval | undefined) ?? null,
  };
}

export function toCheckoutSessionDTO(session: Stripe.Checkout.Session): CheckoutSessionDTO {
  return {
    id: session.id,
    url: session.url ?? '',
  };
}

export function toSubscriptionDTO(subscription: Stripe.Subscription): SubscriptionDTO {
  return {
    providerSubscriptionId: subscription.id,
    status: isSubscriptionStatus(subscription.status) ? subscription.status : 'incomplete',
    currentPeriodEnd: fromUnixSeconds(
      subscription.items.data[0]?.current_period_end ??
        (subscription as { current_period_end?: number | null }).current_period_end,
    ),
    trialEndsAt: fromUnixSeconds(subscription.trial_end),
  };
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
    status: (invoice.status as InvoiceStatus | null) ?? 'draft',
    total: stripeMoney(invoice.total ?? 0, invoice.currency),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
  };
}
