import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { toSubscriptionDTO as toPaddleSubscriptionDTO } from '../src/infrastructure/providers/paddle/paddle-mappers';
import type { PaddleSubscriptionEntity } from '../src/infrastructure/providers/paddle/paddle-types';
import { toSubscriptionDTO as toStripeSubscriptionDTO } from '../src/infrastructure/providers/stripe/stripe-mappers';

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
  });
});
