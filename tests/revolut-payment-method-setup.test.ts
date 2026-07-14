import { describe, expect, it } from 'vitest';
import {
  isPaymentMethodSetupCapable,
  type PaymentMethodSetupCapable,
} from '../src/domain/contracts/payment-provider.contract';
import {
  RevolutProvider,
  type RevolutProviderOptions,
} from '../src/infrastructure/providers/revolut/revolut-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'setup-1' };

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface FakeResponse {
  status?: number;
  body?: unknown;
}

function fakeFetch(...responses: FakeResponse[]) {
  const calls: RecordedRequest[] = [];
  const fetch: NonNullable<RevolutProviderOptions['fetch']> = async (url, init) => {
    const response = responses.shift() ?? {};
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: response.body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function provider(
  fetch?: RevolutProviderOptions['fetch'],
): RevolutProvider & PaymentMethodSetupCapable {
  const instance = new RevolutProvider({
    secretKey: 'sk_rev_test',
    webhookSecret: 'wsk_test',
    environment: 'sandbox',
    fetch,
  });
  if (!isPaymentMethodSetupCapable(instance)) {
    throw new Error('RevolutProvider must implement PaymentMethodSetupCapable');
  }
  return instance;
}

function order(state: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'order_1',
    token: 'order_token_1',
    state,
    checkout_url: 'https://checkout.revolut.test/order_token_1',
    customer: { id: 'customer_1' },
    created_at: '2026-07-14T08:00:00.000Z',
    ...overrides,
  };
}

describe('Revolut payment method setup', () => {
  it('advertises the complete optional capability', () => {
    const { fetch } = fakeFetch();
    const instance = provider(fetch);

    expect(instance.capabilities().has('paymentMethodSetup')).toBe(true);
    expect(isPaymentMethodSetupCapable(instance)).toBe(true);
  });

  it('creates a zero-amount setup order with idempotency', async () => {
    const { fetch, calls } = fakeFetch({ body: order('pending') });

    const result = await provider(fetch).createPaymentMethodSetup(
      {
        providerCustomerId: 'customer_1',
        usage: 'off_session',
        currency: 'EUR',
        returnUrl: 'https://app.test/return',
        reference: 'setup-reference-1',
      },
      ctx,
    );

    expect(calls[0]).toEqual({
      url: 'https://sandbox-merchant.revolut.com/api/orders',
      method: 'POST',
      headers: expect.objectContaining({ 'idempotency-key': 'setup-1' }),
      body: {
        amount: 0,
        currency: 'EUR',
        customer: { id: 'customer_1' },
        merchant_order_data: { reference: 'setup-reference-1' },
        redirect_url: 'https://app.test/return',
      },
    });
    expect(result).toEqual({
      providerSetupId: 'order_1',
      providerCustomerId: 'customer_1',
      status: 'requires_action',
      usage: 'off_session',
      clientSecret: 'order_token_1',
      checkoutUrl: 'https://checkout.revolut.test/order_token_1',
      providerPaymentMethodId: null,
      createdAt: new Date('2026-07-14T08:00:00.000Z'),
    });
  });

  it('requires currency before issuing an HTTP request', async () => {
    const { fetch, calls } = fakeFetch();

    await expect(
      provider(fetch).createPaymentMethodSetup(
        { providerCustomerId: 'customer_1', usage: 'off_session' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_METHOD_SETUP_CURRENCY_REQUIRED' });
    expect(calls).toEqual([]);
  });

  it('rejects on-session setup before issuing an HTTP request', async () => {
    const { fetch, calls } = fakeFetch();

    await expect(
      provider(fetch).createPaymentMethodSetup(
        { providerCustomerId: 'customer_1', usage: 'on_session', currency: 'EUR' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_OPERATION_UNSUPPORTED' });
    expect(calls).toEqual([]);
  });

  it('retrieves a completed setup and maps the saved payment method', async () => {
    const { fetch, calls } = fakeFetch({
      body: order('completed', {
        payments: [
          {
            id: 'payment_failed',
            state: 'failed',
            payment_method: { id: 'payment_method_failed', type: 'card' },
          },
          {
            id: 'payment_completed',
            state: 'completed',
            payment_method: { id: 'payment_method_1', type: 'card' },
          },
        ],
      }),
    });

    const result = await provider(fetch).retrievePaymentMethodSetup('order/1');

    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/orders/order%2F1',
      method: 'GET',
    });
    expect(result).toMatchObject({
      status: 'succeeded',
      providerPaymentMethodId: 'payment_method_1',
    });
  });

  it('does not expose a payment method before the setup order completes', async () => {
    const { fetch } = fakeFetch({
      body: order('pending', {
        payments: [
          {
            id: 'payment_completed',
            state: 'completed',
            payment_method: { id: 'payment_method_1', type: 'card' },
          },
        ],
      }),
    });

    const result = await provider(fetch).retrievePaymentMethodSetup('order_1');

    expect(result.providerPaymentMethodId).toBeNull();
  });

  it('returns no payment method when a completed order has no payments', async () => {
    const { fetch } = fakeFetch({ body: order('completed') });

    const result = await provider(fetch).retrievePaymentMethodSetup('order_1');

    expect(result.providerPaymentMethodId).toBeNull();
  });

  it('cancels a setup order with the operation idempotency key', async () => {
    const { fetch, calls } = fakeFetch({ body: order('cancelled') });

    const result = await provider(fetch).cancelPaymentMethodSetup('order/1', ctx);

    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/orders/order%2F1/cancel',
      method: 'POST',
      headers: expect.objectContaining({ 'idempotency-key': 'setup-1' }),
    });
    expect(result.status).toBe('canceled');
  });

  it.each([
    ['pending', 'requires_action'],
    ['processing', 'processing'],
    ['authorised', 'processing'],
    ['completed', 'succeeded'],
    ['cancelled', 'canceled'],
    ['failed', 'failed'],
    ['future_state', 'unknown'],
  ] as const)('maps %s to %s', async (revolutState, expected) => {
    const { fetch } = fakeFetch({ body: order(revolutState) });

    const result = await provider(fetch).retrievePaymentMethodSetup('order_1');

    expect(result.status).toBe(expected);
  });

  it('normalizes Merchant API errors', async () => {
    const { fetch } = fakeFetch({
      status: 429,
      body: { code: 'too_many_requests', message: 'slow down' },
    });

    await expect(provider(fetch).retrievePaymentMethodSetup('order_1')).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });
  });
});
