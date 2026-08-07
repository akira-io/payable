import { describe, expect, it } from 'vitest';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';

describe('Paddle subscription reconciliation', () => {
  it('uses validated webhook narrowing instead of a blind cast', () => {
    const provider = new PaddleProvider({ apiKey: 'pdl', webhookSecret: 'wh' });
    const subscription = provider.reconcileSubscription({
      providerEventId: 'evt_1',
      type: 'subscription.updated',
      normalizedType: 'subscription.updated',
      data: {
        id: 'sub_9',
        status: 'active',
        currentBillingPeriod: { endsAt: '2026-07-01T00:00:00.000Z' },
      },
    });

    expect(subscription).toMatchObject({ providerSubscriptionId: 'sub_9', status: 'active' });
    expect(subscription?.currentPeriodEnd?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(
      provider.reconcileSubscription({
        providerEventId: 'evt_2',
        type: 'subscription.updated',
        normalizedType: 'subscription.updated',
        data: { id: 'sub_x', status: 'active', currentBillingPeriod: 'garbage' },
      })?.currentPeriodEnd,
    ).toBeNull();
  });
});
