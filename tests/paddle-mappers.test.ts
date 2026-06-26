import { describe, expect, it } from 'vitest';
import {
  toCheckoutSessionDTO,
  toPaddleSubscriptionEntity,
  toSubscriptionDTO,
} from '../src/infrastructure/providers/paddle/paddle-mappers';
import type { PaddleTransaction } from '../src/infrastructure/providers/paddle/paddle-types';

describe('paddle subscription trial mapping', () => {
  it('reads the real trial end from subscription items, not the period end', () => {
    const dto = toSubscriptionDTO({
      id: 'sub_1',
      status: 'trialing',
      currentBillingPeriod: { endsAt: '2026-07-01T00:00:00.000Z' },
      items: [{ trialDates: { endsAt: '2026-06-15T00:00:00.000Z' } }],
    });
    expect(dto.trialEndsAt?.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(dto.currentPeriodEnd?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('reports no trial end when items carry none instead of aliasing the period end', () => {
    const dto = toSubscriptionDTO({
      id: 'sub_2',
      status: 'trialing',
      currentBillingPeriod: { endsAt: '2026-07-01T00:00:00.000Z' },
    });
    expect(dto.trialEndsAt).toBeNull();
  });

  it('extracts the trial end from a snake_case webhook payload', () => {
    const entity = toPaddleSubscriptionEntity({
      id: 'sub_3',
      status: 'trialing',
      currentBillingPeriod: { endsAt: '2026-07-01T00:00:00.000Z' },
      items: [{ trial_dates: { ends_at: '2026-06-20T00:00:00.000Z' } }],
    });
    expect(toSubscriptionDTO(entity).trialEndsAt?.toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });
});

describe('paddle checkout session mapping', () => {
  it('returns the checkout url when present', () => {
    const dto = toCheckoutSessionDTO({
      id: 'txn_1',
      checkout: { url: 'https://pay.paddle.test/txn_1' },
    } as PaddleTransaction);
    expect(dto).toEqual({ id: 'txn_1', url: 'https://pay.paddle.test/txn_1' });
  });

  it('throws when the transaction has no checkout url', () => {
    expect(() => toCheckoutSessionDTO({ id: 'txn_2' } as PaddleTransaction)).toThrow(
      'missing a checkout url',
    );
  });
});
