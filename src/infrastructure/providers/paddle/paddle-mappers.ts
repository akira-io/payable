import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { CustomerDTO } from '../../../domain/dtos/customer.dto';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { RecurringInterval } from '../../../domain/entities/common';
import { Money } from '../../../domain/value-objects/money';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import type { SubscriptionStatus } from '../../../domain/value-objects/subscription-status';
import type {
  PaddleAdjustment,
  PaddleCustomer,
  PaddlePriceEntity,
  PaddleProductEntity,
  PaddleSubscriptionEntity,
  PaddleTransaction,
} from './paddle-types';

const SUBSCRIPTION_STATUS: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
};

export function toCustomerDTO(customer: PaddleCustomer): CustomerDTO {
  return { providerCustomerId: customer.id, email: customer.email ?? '', name: customer.name };
}

export function toProductDTO(product: PaddleProductEntity): ProductDTO {
  return { providerProductId: product.id, name: product.name, active: product.status === 'active' };
}

export function toPriceDTO(price: PaddlePriceEntity): PriceDTO {
  return {
    providerPriceId: price.id,
    providerProductId: price.productId,
    unitAmount: Money.of(
      Number(price.unitPrice.amount),
      price.unitPrice.currencyCode.toUpperCase(),
    ),
    interval: (price.billingCycle?.interval as RecurringInterval | undefined) ?? null,
  };
}

export function toCheckoutSessionDTO(transaction: PaddleTransaction): CheckoutSessionDTO {
  return { id: transaction.id, url: transaction.checkout?.url ?? '' };
}

export function toSubscriptionDTO(subscription: PaddleSubscriptionEntity): SubscriptionDTO {
  const endsAt = subscription.currentBillingPeriod?.endsAt ?? null;
  return {
    providerSubscriptionId: subscription.id,
    status: SUBSCRIPTION_STATUS[subscription.status] ?? 'active',
    currentPeriodEnd: endsAt ? new Date(endsAt) : null,
    trialEndsAt: null,
  };
}

export function toRefundResultDTO(adjustment: PaddleAdjustment): RefundResultDTO {
  const status: RefundStatus = adjustment.status === 'approved' ? 'succeeded' : 'pending';
  return {
    providerRefundId: adjustment.id,
    status,
    amount: Money.of(
      Number(adjustment.totals?.total ?? 0),
      (adjustment.totals?.currencyCode ?? 'USD').toUpperCase(),
    ),
  };
}
