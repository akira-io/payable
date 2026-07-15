import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
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

  it('forwards subscription checkout references as Stripe client references', async () => {
    const calls = new Map<string, { params: unknown; options: { idempotencyKey?: string } }>();
    const stripe = {
      checkout: {
        sessions: {
          create: (params: unknown, options: { idempotencyKey?: string }) => {
            calls.set('checkout.sessions.create', { params, options });
            return Promise.resolve({ id: 'cs_sub_1', url: 'https://checkout.stripe.test/sub' });
          },
        },
      },
    } as unknown as Stripe;

    await new StripeProvider(
      { secretKey: 'stripe_test_key', webhookSecret: 'stripe_webhook_secret' },
      stripe,
    ).createCheckoutSession(
      {
        providerCustomerId: 'cus_1',
        mode: 'subscription',
        lineItems: [{ priceId: 'price_1', quantity: 1 }],
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
        reference: 'sub_checkout_1',
      },
      ctx,
    );

    expect(calls.get('checkout.sessions.create')?.params).toMatchObject({
      client_reference_id: 'sub_checkout_1',
    });
  });
  it('converts a one-time amount into Stripe price_data line items', async () => {
    const calls = new Map<string, { params: unknown }>();
    const stripe = {
      checkout: {
        sessions: {
          create: (params: unknown) => {
            calls.set('checkout.sessions.create', { params });
            return Promise.resolve({ id: 'cs_amt', url: 'https://checkout.stripe.test/cs_amt' });
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
        lineItems: [],
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
        reference: 'order_99',
        amount: Money.of(9900, 'USD'),
      },
      ctx,
    );

    expect(dto.id).toBe('cs_amt');
    expect(calls.get('checkout.sessions.create')?.params).toMatchObject({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 9900,
            product_data: { name: 'order_99' },
          },
        },
      ],
    });
  });

  it('rejects a checkout with neither line items nor an amount before the API call', async () => {
    let called = false;
    const stripe = {
      checkout: {
        sessions: {
          create: () => {
            called = true;
            return Promise.resolve({ id: 'cs_x', url: 'https://checkout.stripe.test/cs_x' });
          },
        },
      },
    } as unknown as Stripe;

    await expect(
      new StripeProvider(
        { secretKey: 'stripe_test_key', webhookSecret: 'stripe_webhook_secret' },
        stripe,
      ).createCheckoutSession(
        {
          providerCustomerId: 'cus_1',
          mode: 'payment',
          lineItems: [],
          successUrl: 'https://app.test/s',
          cancelUrl: 'https://app.test/c',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CHECKOUT_LINE_ITEMS_REQUIRED' });
    expect(called).toBe(false);
  });
});
