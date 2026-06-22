import type Stripe from 'stripe';
import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { CustomerDTO } from '../../../domain/dtos/customer.dto';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { RecurringInterval } from '../../../domain/entities/common';
import { Money } from '../../../domain/value-objects/money';
import type { SubscriptionStatus } from '../../../domain/value-objects/subscription-status';

function fromUnixSeconds(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value * 1000);
}

export function toCustomerDTO(customer: Stripe.Customer): CustomerDTO {
  return {
    providerCustomerId: customer.id,
    email: customer.email ?? '',
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
    unitAmount: Money.of(price.unit_amount ?? 0, price.currency.toUpperCase()),
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
    status: subscription.status as SubscriptionStatus,
    currentPeriodEnd: fromUnixSeconds(subscription.items.data[0]?.current_period_end),
    trialEndsAt: fromUnixSeconds(subscription.trial_end),
  };
}
