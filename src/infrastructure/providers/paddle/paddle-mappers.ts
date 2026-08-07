import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { CustomerDTO } from '../../../domain/dtos/customer.dto';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { Metadata, RecurringInterval } from '../../../domain/entities/common';
import { PayableError } from '../../../domain/errors/payable-error';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import type { SubscriptionStatus } from '../../../domain/value-objects/subscription-status';
import { paddleMoney } from './paddle-amounts';
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
  const minor = Number(text);
  if (!Number.isSafeInteger(minor)) {
    throw new PayableError(`Paddle amount exceeds the safe integer range: ${text}`, {
      code: 'PROVIDER_AMOUNT_INVALID',
    });
  }
  return minor;
}

export function toCustomerDTO(customer: PaddleCustomer): CustomerDTO {
  return {
    providerCustomerId: customer.id,
    email: customer.email ?? null,
    name: customer.name ?? null,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringMetadata(value: Record<string, unknown> | null | undefined): Metadata | null {
  const entries = Object.entries(value ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function toProductDTO(product: PaddleProductEntity): ProductDTO {
  return {
    providerProductId: product.id,
    name: product.name,
    description: stringValue(product.description),
    active: product.status === 'active',
    metadata: stringMetadata(product.customData),
  };
}

export function toPriceDTO(price: PaddlePriceEntity): PriceDTO {
  return {
    providerPriceId: price.id,
    providerProductId: price.productId,
    unitAmount: paddleMoney(toMinorUnits(price.unitPrice.amount), price.unitPrice.currencyCode),
    interval: (stringValue(price.billingCycle?.interval) as RecurringInterval | null) ?? null,
    intervalCount:
      typeof price.billingCycle?.frequency === 'number' ? price.billingCycle.frequency : null,
    description: stringValue(price.description),
    active: price.status === 'active',
    lookupKey: null,
  };
}

export function toCheckoutSessionDTO(transaction: PaddleTransaction): CheckoutSessionDTO {
  const url = transaction.checkout?.url;
  if (!url) {
    throw new PayableError('Paddle transaction is missing a checkout url', {
      code: 'PROVIDER_PADDLE_CHECKOUT_URL_MISSING',
      context: { provider: 'paddle', transactionId: transaction.id },
    });
  }
  return { id: transaction.id, url };
}

export function toPaddleSubscriptionEntity(
  data: Record<string, unknown>,
): PaddleSubscriptionEntity {
  const period = data.currentBillingPeriod;
  const endsAt =
    typeof period === 'object' && period !== null && 'endsAt' in period
      ? (period as { endsAt?: unknown }).endsAt
      : null;
  const rawScheduledChange = data.scheduledChange ?? data.scheduled_change;
  const scheduledChange =
    typeof rawScheduledChange === 'object' && rawScheduledChange !== null
      ? (rawScheduledChange as Record<string, unknown>)
      : null;
  const action = scheduledChange?.action;
  const effectiveAt = scheduledChange?.effectiveAt ?? scheduledChange?.effective_at;
  const resumeAt = scheduledChange?.resumeAt ?? scheduledChange?.resume_at;
  return {
    id: data.id as string,
    status: data.status as string,
    currentBillingPeriod: { endsAt: typeof endsAt === 'string' ? endsAt : null },
    items: Array.isArray(data.items) ? (data.items as PaddleSubscriptionEntity['items']) : null,
    scheduledChange:
      (action === 'pause' || action === 'resume') && typeof effectiveAt === 'string'
        ? {
            action,
            effectiveAt,
            resumeAt: typeof resumeAt === 'string' ? resumeAt : null,
          }
        : null,
  };
}

function readTrialEndsAt(subscription: PaddleSubscriptionEntity): string | null {
  if (subscription.trialEndsAt) {
    return subscription.trialEndsAt;
  }
  for (const item of subscription.items ?? []) {
    const endsAt = item.trialDates?.endsAt ?? item.trial_dates?.ends_at ?? null;
    if (endsAt) {
      return endsAt;
    }
  }
  return null;
}

export function toSubscriptionDTO(subscription: PaddleSubscriptionEntity): SubscriptionDTO {
  const status = SUBSCRIPTION_STATUS[subscription.status] ?? 'incomplete';
  const endsAt = subscription.currentBillingPeriod?.endsAt ?? null;
  const periodEnd = endsAt ? new Date(endsAt) : null;
  const trialEnd = readTrialEndsAt(subscription);
  const scheduled = subscription.scheduledChange;
  return {
    providerSubscriptionId: subscription.id,
    status,
    currentPeriodEnd: periodEnd,
    trialEndsAt: trialEnd ? new Date(trialEnd) : null,
    scheduledChangeAction:
      scheduled?.action === 'pause' || scheduled?.action === 'resume' ? scheduled.action : null,
    scheduledChangeEffectiveAt: scheduled ? new Date(scheduled.effectiveAt) : null,
    scheduledResumeAt: scheduled?.resumeAt ? new Date(scheduled.resumeAt) : null,
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
    amount: paddleMoney(toMinorUnits(adjustment.totals.total), adjustment.totals.currencyCode),
  };
}
