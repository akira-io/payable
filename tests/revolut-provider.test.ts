import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import { Money } from '../src/domain/value-objects/money';
import { isPaymentWebhookCapable } from '../src/index';
import {
  REVOLUT_MERCHANT_API_VERSION,
  RevolutProvider,
  type RevolutProviderOptions,
} from '../src/infrastructure/providers/revolut/revolut-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface FakeResponse {
  status?: number;
  body?: unknown;
}

function fakeFetch(...responses: FakeResponse[]) {
  const calls: RecordedRequest[] = [];
  const fetch: NonNullable<RevolutProviderOptions['fetch']> = async (url, init) => {
    const headers = new Headers(init?.headers);
    const response = responses.shift() ?? {};
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: response.body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function provider(fetch: RevolutProviderOptions['fetch']) {
  return new RevolutProvider({
    secretKey: 'sk_rev_test',
    webhookSecret: 'wsk_test',
    environment: 'sandbox',
    fetch,
  });
}

describe('RevolutProvider', () => {
  it('reports only the Merchant capabilities implemented in this phase', () => {
    const instance = new RevolutProvider({ secretKey: 'sk_rev_test', webhookSecret: 'wsk_test' });
    const capabilities = instance.capabilities();
    expect(capabilities.has('checkout')).toBe(true);
    expect(capabilities.has('refunds')).toBe(true);
    expect(capabilities.has('webhooks')).toBe(true);
    expect(capabilities.has('customers')).toBe(false);
    expect(capabilities.has('catalog')).toBe(false);
    expect(capabilities.has('subscriptions')).toBe(false);
    expect(isPaymentWebhookCapable(instance)).toBe(true);
  });

  it('does not leak secrets when serialized or inspected', () => {
    const instance = new RevolutProvider({
      secretKey: 'sk_rev_secret',
      webhookSecret: 'wsk_secret',
    });
    expect(JSON.stringify(instance)).not.toContain('sk_rev_secret');
    expect(JSON.stringify(instance)).not.toContain('wsk_secret');
    expect(inspect(instance)).not.toContain('sk_rev_secret');
  });

  it('creates a payment checkout order against the sandbox Merchant API', async () => {
    const { fetch, calls } = fakeFetch({
      status: 201,
      body: {
        id: 'ord_1',
        token: 'tok_1',
        state: 'pending',
        amount: 500,
        currency: 'GBP',
        checkout_url: 'https://checkout.revolut.com/payment-link/tok_1',
      },
    });

    const dto = await provider(fetch).createCheckoutSession(
      {
        providerCustomerId: 'local-1',
        mode: 'payment',
        lineItems: [],
        successUrl: 'https://shop.test/success',
        cancelUrl: 'https://shop.test/cancel',
        amount: Money.of(500, 'GBP'),
      },
      ctx,
    );

    expect(dto).toEqual({
      id: 'ord_1',
      url: 'https://checkout.revolut.com/payment-link/tok_1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/orders',
      method: 'POST',
      body: {
        amount: 500,
        currency: 'GBP',
        redirect_url: 'https://shop.test/success',
      },
    });
    expect(calls[0]?.headers.authorization).toBe('Bearer sk_rev_test');
    expect(calls[0]?.headers['revolut-api-version']).toBe(REVOLUT_MERCHANT_API_VERSION);
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('rejects non-payment checkout because Revolut subscriptions are outside this phase', async () => {
    const { fetch } = fakeFetch();
    await expect(
      provider(fetch).createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'subscription',
          lineItems: [],
          successUrl: 'https://shop.test/success',
          cancelUrl: 'https://shop.test/cancel',
          amount: Money.of(500, 'GBP'),
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_OPERATION_UNSUPPORTED' });
  });

  it('requires an amount for Revolut checkout orders', async () => {
    const { fetch } = fakeFetch();
    await expect(
      provider(fetch).createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'payment',
          lineItems: [],
          successUrl: 'https://shop.test/success',
          cancelUrl: 'https://shop.test/cancel',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CHECKOUT_AMOUNT_REQUIRED' });
  });

  it('refunds a Revolut order and forwards the idempotency key where the API supports it', async () => {
    const { fetch, calls } = fakeFetch({
      status: 201,
      body: {
        id: 'refund_1',
        type: 'refund',
        state: 'processing',
        amount: 100,
        currency: 'GBP',
        related_order_id: 'ord_1',
      },
    });

    const dto = await provider(fetch).refund(
      { providerPaymentId: 'ord_1', amount: Money.of(100, 'GBP'), reason: 'Returned item' },
      ctx,
    );

    expect(dto.providerRefundId).toBe('refund_1');
    expect(dto.status).toBe('pending');
    expect(dto.amount.amount()).toBe(100);
    expect(dto.amount.currency()).toBe('GBP');
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/orders/ord_1/refund',
      method: 'POST',
      body: { amount: 100, currency: 'GBP', description: 'Returned item' },
    });
    expect(calls[0]?.headers['idempotency-key']).toBe('idem-1');
  });

  it('requires an explicit amount for Revolut refunds', async () => {
    const { fetch } = fakeFetch();
    await expect(provider(fetch).refund({ providerPaymentId: 'ord_1' }, ctx)).rejects.toMatchObject(
      { code: 'REFUND_AMOUNT_REQUIRED' },
    );
  });

  it('normalizes Revolut API errors into Payable errors', async () => {
    const { fetch } = fakeFetch({
      status: 401,
      body: { code: 'unauthenticated', message: 'Authentication failed' },
    });

    await expect(
      provider(fetch).createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'payment',
          lineItems: [],
          successUrl: 'https://shop.test/success',
          cancelUrl: 'https://shop.test/cancel',
          amount: Money.of(500, 'GBP'),
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      context: { provider: 'revolut', revolutCode: 'unauthenticated', status: 401 },
    });
  });

  it('throws if Revolut returns an order without a checkout URL', async () => {
    const { fetch } = fakeFetch({
      status: 201,
      body: { id: 'ord_1', state: 'pending', amount: 500, currency: 'GBP' },
    });

    await expect(
      provider(fetch).createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'payment',
          lineItems: [],
          successUrl: 'https://shop.test/success',
          cancelUrl: 'https://shop.test/cancel',
          amount: Money.of(500, 'GBP'),
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(PayableError);
  });
});
