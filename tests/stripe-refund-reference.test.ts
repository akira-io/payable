import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

describe('StripeProvider refund references', () => {
  it('forwards refund references as Stripe metadata', async () => {
    const calls = new Map<string, { params: unknown; options: { idempotencyKey?: string } }>();
    const stripe = {
      refunds: {
        create: (params: unknown, options: { idempotencyKey?: string }) => {
          calls.set('refunds.create', { params, options });
          return Promise.resolve({
            id: 're_1',
            status: 'succeeded',
            amount: 4_000,
            currency: 'usd',
          });
        },
      },
    } as unknown as Stripe;

    await new StripeProvider(
      { secretKey: 'stripe_test_key', webhookSecret: 'stripe_webhook_secret' },
      stripe,
    ).refund(
      {
        providerPaymentId: 'pi_1',
        amount: Money.of(4_000, 'USD'),
        reason: 'requested_by_customer',
        reference: 'refund_42',
      },
      ctx,
    );

    expect(calls.get('refunds.create')?.params).toMatchObject({
      metadata: { reference: 'refund_42' },
    });
    expect(calls.get('refunds.create')?.options.idempotencyKey).toBe('idem-1');
  });
});
