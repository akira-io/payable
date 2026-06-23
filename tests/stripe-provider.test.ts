import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  STRIPE_API_VERSION,
  StripeProvider,
} from '../src/infrastructure/providers/stripe/stripe-provider';

interface RecordedCall {
  params: unknown;
  options: { idempotencyKey?: string };
}

function fakeStripe() {
  const calls = new Map<string, RecordedCall>();
  const record =
    (name: string, result: unknown) => (params: unknown, options: { idempotencyKey?: string }) => {
      calls.set(name, { params, options });
      return Promise.resolve(result);
    };
  const client = {
    customers: {
      create: record('customers.create', { id: 'cus_1', email: 'user@example.com', name: 'User' }),
      update: record('customers.update', { id: 'cus_1', email: 'new@example.com', name: 'User' }),
    },
    products: {
      create: record('products.create', { id: 'prod_1', name: 'Pro', active: true }),
      update: record('products.update', { id: 'prod_1', name: 'Pro', active: false }),
    },
    prices: {
      create: record('prices.create', {
        id: 'price_1',
        product: 'prod_1',
        unit_amount: 9900,
        currency: 'usd',
        recurring: { interval: 'month' },
      }),
    },
    checkout: {
      sessions: {
        create: record('checkout.sessions.create', {
          id: 'cs_1',
          url: 'https://checkout.stripe.test/cs_1',
        }),
      },
    },
  };
  return { client: client as unknown as Stripe, calls };
}

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };
const provider = (client: Stripe) =>
  new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' }, client);

describe('StripeProvider', () => {
  it('reports Stripe capabilities', () => {
    const { client } = fakeStripe();
    expect(provider(client).capabilities().checkout).toBe(true);
  });

  it('creates a customer and forwards the idempotency key', async () => {
    const { client, calls } = fakeStripe();
    const dto = await provider(client).createCustomer(
      { email: 'user@example.com', name: 'User', billableType: 'User', billableId: '1' },
      ctx,
    );
    expect(dto).toEqual({ providerCustomerId: 'cus_1', email: 'user@example.com', name: 'User' });
    expect(calls.get('customers.create')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('customers.create')?.params).toMatchObject({ email: 'user@example.com' });
  });

  it('converts Money at the price boundary', async () => {
    const { client, calls } = fakeStripe();
    const dto = await provider(client).createPrice(
      { providerProductId: 'prod_1', unitAmount: Money.of(9900, 'USD'), interval: 'month' },
      ctx,
    );
    expect(calls.get('prices.create')?.params).toMatchObject({
      product: 'prod_1',
      currency: 'usd',
      unit_amount: 9900,
      recurring: { interval: 'month', interval_count: 1 },
    });
    expect(dto.unitAmount.amount()).toBe(9900);
    expect(dto.unitAmount.currency()).toBe('USD');
    expect(dto.interval).toBe('month');
  });

  it('creates a subscription checkout session with a trial', async () => {
    const { client, calls } = fakeStripe();
    const dto = await provider(client).createCheckoutSession(
      {
        providerCustomerId: 'cus_1',
        mode: 'subscription',
        lineItems: [{ priceId: 'price_1', quantity: 1 }],
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
        trialDays: 14,
      },
      ctx,
    );
    expect(dto).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    expect(calls.get('checkout.sessions.create')?.params).toMatchObject({
      customer: 'cus_1',
      mode: 'subscription',
      line_items: [{ price: 'price_1', quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
    });
    expect(calls.get('checkout.sessions.create')?.options.idempotencyKey).toBe('idem-1');
  });

  it('creates a billing portal session', async () => {
    const calls = new Map<string, { params: unknown; options: { idempotencyKey?: string } }>();
    const stripe = {
      billingPortal: {
        sessions: {
          create: (params: unknown, options: { idempotencyKey?: string }) => {
            calls.set('portal', { params, options });
            return Promise.resolve({ url: 'https://billing.stripe.test/p' });
          },
        },
      },
    } as unknown as Stripe;

    const dto = await new StripeProvider(
      { secretKey: 'sk', webhookSecret: 'wh' },
      stripe,
    ).billingPortal({ providerCustomerId: 'cus_1', returnUrl: 'https://app.test/account' }, ctx);

    expect(dto).toEqual({ url: 'https://billing.stripe.test/p' });
    expect(calls.get('portal')?.params).toMatchObject({
      customer: 'cus_1',
      return_url: 'https://app.test/account',
    });
    expect(calls.get('portal')?.options.idempotencyKey).toBe('idem-1');
  });

  it('pins a fixed Stripe API version', () => {
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('translates a Stripe card error into a typed PayableError', async () => {
    const stripe = {
      paymentIntents: {
        create: () => {
          throw {
            type: 'StripeCardError',
            code: 'card_declined',
            message: 'Your card was declined',
          };
        },
      },
    } as unknown as Stripe;

    await expect(
      new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe).charge(
        { amount: Money.of(1000, 'USD') },
        { correlationId: 'c', idempotencyKey: 'i' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_CARD_DECLINED' });
  });
});
