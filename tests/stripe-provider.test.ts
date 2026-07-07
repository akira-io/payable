import { inspect } from 'node:util';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { toCheckoutSessionDTO } from '../src/infrastructure/providers/stripe/stripe-mappers';
import {
  STRIPE_API_VERSION,
  StripeProvider,
} from '../src/infrastructure/providers/stripe/stripe-provider';

interface RecordedCall {
  args: unknown[];
  params: unknown;
  options: { idempotencyKey?: string };
}

function fakeStripe() {
  const calls = new Map<string, RecordedCall>();
  const requestOptions = (value: unknown): { idempotencyKey?: string } => {
    if (typeof value !== 'object' || value === null || !('idempotencyKey' in value)) {
      return {};
    }
    return value as { idempotencyKey?: string };
  };
  const requestParams = (args: unknown[]) => (args.length >= 3 ? args[1] : args[0]);
  const record =
    (name: string, result: unknown) =>
    (...args: unknown[]) => {
      calls.set(name, {
        args,
        params: requestParams(args),
        options: requestOptions(args.at(-1)),
      });
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
    paymentIntents: {
      create: record('paymentIntents.create', {
        id: 'pi_1',
        status: 'succeeded',
        amount: 9900,
        currency: 'usd',
      }),
    },
    refunds: {
      create: record('refunds.create', {
        id: 're_1',
        status: 'succeeded',
        amount: 9900,
        currency: 'usd',
      }),
    },
    billingPortal: {
      sessions: {
        create: record('billingPortal.sessions.create', {
          url: 'https://billing.stripe.test/p',
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
    expect(provider(client).capabilities().has('checkout')).toBe(true);
  });

  it('does not leak secrets when serialized or inspected', () => {
    const instance = new StripeProvider({
      secretKey: 'sk_live_secret',
      webhookSecret: 'wh_secret',
    });
    expect(JSON.stringify(instance)).not.toContain('sk_live_secret');
    expect(JSON.stringify(instance)).not.toContain('wh_secret');
    expect(inspect(instance)).not.toContain('sk_live_secret');
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

  it('forwards idempotency keys on Stripe write operations', async () => {
    const { client, calls } = fakeStripe();
    const instance = provider(client);

    await instance.createCustomer(
      { email: 'user@example.com', name: 'User', billableType: 'User', billableId: '1' },
      ctx,
    );
    await instance.updateCustomer(
      { providerCustomerId: 'cus_1', email: 'new@example.com', name: 'User' },
      ctx,
    );
    await instance.createProduct({ name: 'Pro', active: true }, ctx);
    await instance.updateProduct({ providerProductId: 'prod_1', name: 'Pro', active: false }, ctx);
    await instance.createPrice(
      { providerProductId: 'prod_1', unitAmount: Money.of(9900, 'USD') },
      ctx,
    );
    await instance.createCheckoutSession(
      {
        providerCustomerId: 'cus_1',
        mode: 'payment',
        lineItems: [{ priceId: 'price_1', quantity: 1 }],
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      },
      ctx,
    );
    await instance.charge({ amount: Money.of(9900, 'USD') }, ctx);
    await instance.refund({ providerPaymentId: 'pi_1', amount: Money.of(9900, 'USD') }, ctx);
    await instance.billingPortal(
      { providerCustomerId: 'cus_1', returnUrl: 'https://app.test/account' },
      ctx,
    );

    expect(calls.get('customers.create')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('customers.update')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('products.create')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('products.update')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('prices.create')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('checkout.sessions.create')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('paymentIntents.create')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('refunds.create')?.options.idempotencyKey).toBe('idem-1');
    expect(calls.get('billingPortal.sessions.create')?.options.idempotencyKey).toBe('idem-1');
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

  it('rejects a fractional unit_amount_decimal price instead of silently rounding it', async () => {
    const client = {
      prices: {
        create: async () => ({
          id: 'price_frac',
          product: 'prod_1',
          unit_amount: null,
          unit_amount_decimal: '2.5',
          currency: 'usd',
        }),
      },
    } as unknown as Stripe;

    await expect(
      provider(client).createPrice(
        { providerProductId: 'prod_1', unitAmount: Money.of(100, 'USD') },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_PRICE_AMOUNT_FRACTIONAL' });
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

  it('rejects a subscription webhook payload missing id or status', () => {
    const { client } = fakeStripe();
    expect(() =>
      provider(client).reconcileSubscription({
        providerEventId: 'evt_1',
        type: 'customer.subscription.updated',
        normalizedType: 'subscription.updated',
        data: { foo: 'bar' },
      }),
    ).toThrow('Webhook subscription payload is missing id or status');
  });

  it('narrows a subscription webhook payload defensively, ignoring malformed nested fields', () => {
    const { client } = fakeStripe();
    const dto = provider(client).reconcileSubscription({
      providerEventId: 'evt_2',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      data: {
        id: 'sub_1',
        status: 'active',
        items: { data: [{ current_period_end: 1_893_456_000 }, { current_period_end: 'bad' }] },
        trial_end: null,
      },
    });
    expect(dto).toMatchObject({
      providerSubscriptionId: 'sub_1',
      status: 'active',
      trialEndsAt: null,
    });
    expect(dto?.currentPeriodEnd?.toISOString()).toBe(new Date(1_893_456_000 * 1000).toISOString());
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

  it('translates errors on non-charge operations into typed PayableErrors', async () => {
    const stripe = {
      customers: {
        create: () => {
          throw { type: 'StripeInvalidRequestError', code: 'parameter_invalid', message: 'bad' };
        },
      },
    } as unknown as Stripe;

    await expect(
      new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe).createCustomer(
        { billableType: 'User', billableId: '1', email: 'user@example.com' },
        { correlationId: 'c', idempotencyKey: 'i' },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
  });
});

describe('stripe checkout session mapping', () => {
  it('returns the redirect url when present', () => {
    const dto = toCheckoutSessionDTO({
      id: 'cs_1',
      url: 'https://checkout.stripe.test/cs_1',
    } as Stripe.Checkout.Session);
    expect(dto).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
  });

  it('throws when the session has no redirect url', () => {
    expect(() =>
      toCheckoutSessionDTO({ id: 'cs_2', url: null } as Stripe.Checkout.Session),
    ).toThrow('missing a redirect url');
  });
});
