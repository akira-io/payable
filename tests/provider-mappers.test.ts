import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  toCustomerDTO as toPaddleCustomerDTO,
  toPriceDTO as toPaddlePriceDTO,
  toRefundResultDTO as toPaddleRefundDTO,
  toSubscriptionDTO as toPaddleSubscriptionDTO,
} from '../src/infrastructure/providers/paddle/paddle-mappers';
import type {
  PaddleAdjustment,
  PaddleCustomer,
  PaddlePriceEntity,
  PaddleSubscriptionEntity,
} from '../src/infrastructure/providers/paddle/paddle-types';
import { withStripeErrors } from '../src/infrastructure/providers/stripe/stripe-errors';
import {
  toChargeResultDTO as toStripeChargeResultDTO,
  toCustomerDTO as toStripeCustomerDTO,
  toInvoiceDTO as toStripeInvoiceDTO,
  toPriceDTO as toStripePriceDTO,
  toRefundResultDTO as toStripeRefundResultDTO,
  toSubscriptionDTO as toStripeSubscriptionDTO,
} from '../src/infrastructure/providers/stripe/stripe-mappers';

describe('stripe customer mapping', () => {
  it('maps a missing email to null rather than an empty string', () => {
    const dto = toStripeCustomerDTO({ id: 'cus_1', email: null, name: null } as Stripe.Customer);
    expect(dto.email).toBeNull();
  });
});

describe('stripe price mapping', () => {
  it('maps an integer unit amount', () => {
    const dto = toStripePriceDTO({
      id: 'price_1',
      product: 'prod_1',
      unit_amount: 1999,
      unit_amount_decimal: '1999',
      currency: 'usd',
      recurring: { interval: 'month' },
    } as unknown as Stripe.Price);
    expect(dto.unitAmount.amount()).toBe(1999);
  });

  it('falls back to an integer unit_amount_decimal when unit_amount is null', () => {
    const dto = toStripePriceDTO({
      id: 'price_2',
      product: 'prod_1',
      unit_amount: null,
      unit_amount_decimal: '500',
      currency: 'usd',
    } as unknown as Stripe.Price);
    expect(dto.unitAmount.amount()).toBe(500);
  });

  it('throws instead of defaulting to zero when no amount is resolvable', () => {
    expect(() =>
      toStripePriceDTO({
        id: 'price_3',
        product: 'prod_1',
        unit_amount: null,
        unit_amount_decimal: null,
        currency: 'usd',
      } as unknown as Stripe.Price),
    ).toThrowError(/no resolvable unit amount/);
  });

  it('rejects a fractional unit_amount_decimal instead of silently rounding it', () => {
    expect(() =>
      toStripePriceDTO({
        id: 'price_4',
        product: 'prod_1',
        unit_amount: null,
        unit_amount_decimal: '1234.5',
        currency: 'usd',
      } as unknown as Stripe.Price),
    ).toThrowError(expect.objectContaining({ code: 'PROVIDER_PRICE_AMOUNT_FRACTIONAL' }));
  });
});

describe('stripe subscription mapping', () => {
  it('falls back to a non-granting status for an unknown provider status', () => {
    const dto = toStripeSubscriptionDTO({
      id: 'sub_1',
      status: 'frozen',
      items: { data: [] },
      trial_end: null,
    } as unknown as Stripe.Subscription);
    expect(dto.status).toBe('incomplete');
    expect(dto.currentPeriodEnd).toBeNull();
  });

  it('passes a known status through', () => {
    const dto = toStripeSubscriptionDTO({
      id: 'sub_2',
      status: 'past_due',
      items: { data: [{ current_period_end: 1_750_000_000 }] },
      trial_end: null,
    } as unknown as Stripe.Subscription);
    expect(dto.status).toBe('past_due');
    expect(dto.currentPeriodEnd).not.toBeNull();
  });

  it('falls back to the subscription-level period end when items omit it', () => {
    const dto = toStripeSubscriptionDTO({
      id: 'sub_3',
      status: 'active',
      items: { data: [] },
      current_period_end: 1_750_000_000,
      trial_end: null,
    } as unknown as Stripe.Subscription);
    expect(dto.currentPeriodEnd?.toISOString()).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });

  it('reports the earliest period end across multi-item subscriptions', () => {
    const dto = toStripeSubscriptionDTO({
      id: 'sub_4',
      status: 'active',
      items: {
        data: [{ current_period_end: 1_760_000_000 }, { current_period_end: 1_750_000_000 }],
      },
      trial_end: null,
    } as unknown as Stripe.Subscription);
    expect(dto.currentPeriodEnd?.toISOString()).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });

  it('does not throw when a webhook subscription payload omits items', () => {
    const dto = toStripeSubscriptionDTO({
      id: 'sub_5',
      status: 'active',
      current_period_end: 1_750_000_000,
      trial_end: null,
    } as unknown as Stripe.Subscription);
    expect(dto.currentPeriodEnd?.toISOString()).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });
});

describe('paddle subscription mapping', () => {
  it('falls back to a non-granting status for an unknown provider status', () => {
    const dto = toPaddleSubscriptionDTO({
      id: 'sub_3',
      status: 'frozen',
      currentBillingPeriod: null,
    } as unknown as PaddleSubscriptionEntity);
    expect(dto.status).toBe('incomplete');
  });

  it('passes a known status through', () => {
    const dto = toPaddleSubscriptionDTO({
      id: 'sub_4',
      status: 'past_due',
      currentBillingPeriod: { endsAt: '2026-07-22T00:00:00.000Z' },
    } as unknown as PaddleSubscriptionEntity);
    expect(dto.status).toBe('past_due');
    expect(dto.trialEndsAt).toBeNull();
  });

  it('reports the trial end from the subscription items, not the billing period', () => {
    const dto = toPaddleSubscriptionDTO({
      id: 'sub_trial',
      status: 'trialing',
      currentBillingPeriod: { endsAt: '2026-07-06T00:00:00.000Z' },
      items: [{ trialDates: { endsAt: '2026-06-20T00:00:00.000Z' } }],
    } as unknown as PaddleSubscriptionEntity);
    expect(dto.status).toBe('trialing');
    expect(dto.trialEndsAt?.toISOString()).toBe('2026-06-20T00:00:00.000Z');
    expect(dto.currentPeriodEnd?.toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });
});

describe('paddle amount parsing', () => {
  it('parses an integer minor-unit price amount', () => {
    const dto = toPaddlePriceDTO({
      id: 'pri_1',
      productId: 'pro_1',
      unitPrice: { amount: '1999', currencyCode: 'usd' },
    } as unknown as PaddlePriceEntity);
    expect(dto.unitAmount.amount()).toBe(1999);
  });

  it('throws on a non-integer amount instead of corrupting it', () => {
    expect(() =>
      toPaddleRefundDTO({
        id: 'adj_1',
        status: 'approved',
        totals: { total: '12.5', currencyCode: 'usd' },
      } as unknown as PaddleAdjustment),
    ).toThrowError(/integer minor-unit/);
  });

  it('maps adjustment statuses including rejected and pending_approval', () => {
    const make = (status: string) =>
      toPaddleRefundDTO({
        id: 'adj_1',
        status,
        totals: { total: '9900', currencyCode: 'usd' },
      } as unknown as PaddleAdjustment);
    expect(make('approved').status).toBe('succeeded');
    expect(make('rejected').status).toBe('failed');
    expect(make('pending_approval').status).toBe('pending');
    expect(make('something_new').status).toBe('pending');
  });

  it('throws when adjustment totals are missing instead of fabricating zero USD', () => {
    expect(() =>
      toPaddleRefundDTO({ id: 'adj_1', status: 'approved' } as unknown as PaddleAdjustment),
    ).toThrowError(/missing totals/);
  });

  it('maps a zero-decimal currency without rescaling the minor units', () => {
    const dto = toPaddlePriceDTO({
      id: 'pri_jpy',
      productId: 'pro_1',
      unitPrice: { amount: '500', currencyCode: 'jpy' },
    } as unknown as PaddlePriceEntity);
    expect(dto.unitAmount.amount()).toBe(500);
    expect(dto.unitAmount.currency()).toBe('JPY');
  });

  it('wraps an unsupported currency in a PayableError instead of a raw RangeError', () => {
    expect(() =>
      toPaddleRefundDTO({
        id: 'adj_x',
        status: 'approved',
        totals: { total: '100', currencyCode: 'zzz' },
      } as unknown as PaddleAdjustment),
    ).toThrowError(/PROVIDER_CURRENCY_UNSUPPORTED|not supported/);
  });
});

describe('stripe invoice mapping', () => {
  it('treats a missing total as zero rather than throwing', () => {
    const dto = toStripeInvoiceDTO({
      id: 'in_1',
      status: 'draft',
      total: null,
      currency: 'usd',
    } as unknown as Stripe.Invoice);
    expect(dto.total.amount()).toBe(0);
  });

  it('passes a known invoice status through', () => {
    const dto = toStripeInvoiceDTO({
      id: 'in_2',
      status: 'open',
      total: 9900,
      currency: 'usd',
    } as unknown as Stripe.Invoice);
    expect(dto.status).toBe('open');
  });

  it('falls back to draft for an unmodeled provider status instead of casting a lie', () => {
    const dto = toStripeInvoiceDTO({
      id: 'in_3',
      status: 'deleted',
      total: 0,
      currency: 'usd',
    } as unknown as Stripe.Invoice);
    expect(dto.status).toBe('draft');
  });
});

describe('stripe payment intent mapping', () => {
  it('maps modern payment intent statuses to domain statuses', () => {
    const succeeded = toStripeChargeResultDTO({
      id: 'pi_succeeded',
      status: 'succeeded',
      amount: 100,
      currency: 'usd',
    } as Stripe.PaymentIntent);
    const processing = toStripeChargeResultDTO({
      id: 'pi_processing',
      status: 'processing',
      amount: 100,
      currency: 'usd',
    } as Stripe.PaymentIntent);
    const requiresAction = toStripeChargeResultDTO({
      id: 'pi_action',
      status: 'requires_action',
      amount: 100,
      currency: 'usd',
    } as Stripe.PaymentIntent);
    const unknown = toStripeChargeResultDTO({
      id: 'pi_unknown',
      status: 'requires_mandate',
      amount: 100,
      currency: 'usd',
    } as unknown as Stripe.PaymentIntent);

    expect(succeeded.status).toBe('succeeded');
    expect(processing.status).toBe('processing');
    expect(requiresAction.status).toBe('pending');
    expect(unknown.status).toBe('pending');
  });
});

describe('stripe refund mapping', () => {
  it('maps modern refund statuses to domain statuses', () => {
    const succeeded = toStripeRefundResultDTO({
      id: 're_succeeded',
      status: 'succeeded',
      amount: 100,
      currency: 'usd',
    } as Stripe.Refund);
    const requiresAction = toStripeRefundResultDTO({
      id: 're_action',
      status: 'requires_action',
      amount: 100,
      currency: 'usd',
    } as Stripe.Refund);
    const unknown = toStripeRefundResultDTO({
      id: 're_unknown',
      status: 'new_status',
      amount: 100,
      currency: 'usd',
    } as unknown as Stripe.Refund);

    expect(succeeded.status).toBe('succeeded');
    expect(requiresAction.status).toBe('pending');
    expect(unknown.status).toBe('pending');
  });
});

describe('paddle customer mapping', () => {
  it('maps a missing name to null rather than undefined', () => {
    const dto = toPaddleCustomerDTO({
      id: 'ctm_1',
      email: 'a@b.test',
      name: null,
    } as PaddleCustomer);
    expect(dto.name).toBeNull();
  });
});

describe('stripe error detection', () => {
  it('rethrows a non-stripe error that merely has a type field', async () => {
    const foreign = { type: 'something_else', message: 'not stripe' };
    await expect(
      withStripeErrors(async () => {
        throw foreign;
      }),
    ).rejects.toBe(foreign);
  });

  it('wraps a stripe-shaped error in a PayableError', async () => {
    await expect(
      withStripeErrors(async () => {
        throw { type: 'StripeCardError', code: 'card_declined', message: 'declined' };
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CARD_DECLINED' });
  });
});
