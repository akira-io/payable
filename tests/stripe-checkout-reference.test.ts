import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

describe('StripeProvider checkout references', () => {
  it('forwards checkout references as Stripe client references', async () => {
    const calls = new Map<string, { params: unknown; options: { idempotencyKey?: string } }>();
    const stripe = {
      checkout: {
        sessions: {
          create: (params: unknown, options: { idempotencyKey?: string }) => {
            calls.set('checkout.sessions.create', { params, options });
            return Promise.resolve({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
          },
        },
      },
    } as unknown as Stripe;

    const dto = await new StripeProvider(
      { secretKey: 'stripe_test_key', webhookSecret: 'stripe_webhook_secret' },
      stripe,
    ).createCheckoutSession(
      {
        providerCustomerId: 'cus_1',
        mode: 'payment',
        lineItems: [{ priceId: 'price_1', quantity: 1 }],
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
        reference: 'order_42',
      },
      ctx,
    );

    expect(dto).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    expect(calls.get('checkout.sessions.create')?.params).toMatchObject({
      client_reference_id: 'order_42',
    });
    expect(calls.get('checkout.sessions.create')?.options.idempotencyKey).toBe('idem-1');
  });
});
