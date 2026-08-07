import { describe, expect, it } from 'vitest';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import type { PaddleClient } from '../src/infrastructure/providers/paddle/paddle-types';

const context = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

describe('Paddle subscription lifecycle', () => {
  it('maps explicit pause, resume, and scheduled-change cancellation policies', async () => {
    const calls = new Map<string, unknown>();
    const client = {
      subscriptions: {
        pause: (_id: string, body: unknown) => {
          calls.set('pause', body);
          return Promise.resolve({
            id: 'sub_1',
            status: 'active',
            scheduledChange: {
              action: 'pause',
              effectiveAt: '2026-09-01T00:00:00.000Z',
              resumeAt: '2026-10-01T00:00:00.000Z',
            },
          });
        },
        resume: (_id: string, body: unknown) => {
          calls.set('resume', body);
          return Promise.resolve({ id: 'sub_1', status: 'active' });
        },
        update: (_id: string, body: unknown) => {
          calls.set('update', body);
          return Promise.resolve({ id: 'sub_1', status: 'active' });
        },
      },
    } as unknown as PaddleClient;
    const provider = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, client);

    const paused = await provider.pauseSubscription(
      {
        providerSubscriptionId: 'sub_1',
        effectiveTiming: 'nextRenewal',
        resumeAt: new Date('2026-10-01T00:00:00.000Z'),
        resumeBillingPolicy: 'continueExistingBillingPeriod',
      },
      context,
    );
    await provider.resumePausedSubscription(
      {
        providerSubscriptionId: 'sub_1',
        effectiveTiming: 'scheduled',
        effectiveAt: new Date('2026-11-01T00:00:00.000Z'),
        billingPolicy: 'startNewBillingPeriod',
      },
      context,
    );
    await provider.cancelScheduledSubscriptionChange({ providerSubscriptionId: 'sub_1' }, context);

    expect(calls.get('pause')).toEqual({
      effectiveFrom: 'next_billing_period',
      resumeAt: '2026-10-01T00:00:00.000Z',
      onResume: 'continue_existing_billing_period',
    });
    expect(calls.get('resume')).toEqual({
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      onResume: 'start_new_billing_period',
    });
    expect(calls.get('update')).toEqual({ scheduledChange: null });
    expect(paused).toMatchObject({
      scheduledChangeAction: 'pause',
      scheduledChangeEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      scheduledResumeAt: new Date('2026-10-01T00:00:00.000Z'),
    });
  });
});
