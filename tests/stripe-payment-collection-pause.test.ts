import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const context = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

describe('Stripe payment collection pause', () => {
  it('maps payment collection without changing the lifecycle status', async () => {
    const requests: unknown[][] = [];
    const client = {
      subscriptions: {
        update: (...request: unknown[]) => {
          requests.push(request);
          return Promise.resolve({
            id: 'sub_1',
            status: 'active',
            items: { data: [] },
            pause_collection: { behavior: 'void', resumes_at: 1_788_220_800 },
          });
        },
      },
    } as unknown as Stripe;
    const provider = new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, client);

    const paused = await provider.pausePaymentCollection(
      {
        providerSubscriptionId: 'sub_1',
        behavior: 'void',
        resumesAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      context,
    );
    expect(requests[0]?.[1]).toEqual({
      pause_collection: { behavior: 'void', resumes_at: 1_788_220_800 },
    });
    expect(paused).toMatchObject({
      status: 'active',
      paymentCollectionPauseBehavior: 'void',
      paymentCollectionResumesAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    await provider.resumePaymentCollection({ providerSubscriptionId: 'sub_1' }, context);
    expect(requests[1]?.[1]).toEqual({ pause_collection: '' });
  });
});
