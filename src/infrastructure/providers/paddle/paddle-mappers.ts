import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { CustomerDTO } from '../../../domain/dtos/customer.dto';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { RecurringInterval } from '../../../domain/entities/common';
import { PayableError } from '../../../domain/errors/payable-error';
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

function toMinorUnits(value: string | number | null | undefined): number {
  const text = String(value ?? '').trim();
  if (!/^-?\d+$/.test(text)) {
    throw new PayableError(`Paddle amount is not an integer minor-unit value: ${text}`, {
      code: 'PROVIDER_AMOUNT_INVALID',
    });
  }
  return Number(text);
}

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
      toMinorUnits(price.unitPrice.amount),
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
    status: SUBSCRIPTION_STATUS[subscription.status] ?? 'incomplete',
    currentPeriodEnd: endsAt ? new Date(endsAt) : null,
    trialEndsAt: null,
  };
}

const REFUND_STATUS_BY_ADJUSTMENT: Record<string, RefundStatus> = {
  approved: 'succeeded',
  rejected: 'failed',
  pending_approval: 'pending',
};

export function toRefundResultDTO(adjustment: PaddleAdjustment): RefundResultDTO {
  if (!adjustment.totals) {
    throw new PayableError('Paddle adjustment is missing totals', {
      code: 'PROVIDER_RESPONSE_INVALID',
      context: { adjustmentId: adjustment.id },
    });
  }
  return {
    providerRefundId: adjustment.id,
    status: REFUND_STATUS_BY_ADJUSTMENT[adjustment.status] ?? 'pending',
    amount: Money.of(
      toMinorUnits(adjustment.totals.total),
      adjustment.totals.currencyCode.toUpperCase(),
    ),
  };
}
