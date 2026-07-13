import { describe, expect, it } from 'vitest';
import {
  isPaymentMethodCapable,
  type PaymentMethodCapable,
} from '../src/domain/contracts/payment-provider.contract';
import {
  RevolutProvider,
  type RevolutProviderOptions,
} from '../src/infrastructure/providers/revolut/revolut-provider';

const ctx = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
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
    });
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: response.body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function provider(fetch?: RevolutProviderOptions['fetch']): RevolutProvider & PaymentMethodCapable {
  const instance = new RevolutProvider({
    secretKey: 'sk_rev_test',
    webhookSecret: 'wsk_test',
    environment: 'sandbox',
    fetch,
  });
  if (!isPaymentMethodCapable(instance)) {
    throw new Error('RevolutProvider must implement PaymentMethodCapable');
  }
  return instance;
}

describe('Revolut payment methods', () => {
  it('declares the optional capability', () => {
    const instance = provider();
    expect(instance.capabilities().has('paymentMethods')).toBe(true);
    expect(isPaymentMethodCapable(instance)).toBe(true);
  });

  it('lists and maps saved customer payment methods within the requested limit', async () => {
    const { fetch, calls } = fakeFetch({
      body: {
        payment_methods: [
          {
            id: 'pm_card',
            type: 'card',
            brand: 'visa',
            last_four: '4242',
            expiry_month: 7,
            expiry_year: 2030,
          },
          { id: 'pm_revolut', type: 'revolut_pay' },
          { id: 'pm_sepa', type: 'sepa_direct_debit', debtor_iban_last_four: '1234' },
        ],
      },
    });

    const result = await provider(fetch).listPaymentMethods({
      providerCustomerId: 'cust_1',
      limit: 2,
    });

    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/customers/cust_1/payment-methods',
      method: 'GET',
    });
    expect(result).toEqual([
      {
        providerPaymentMethodId: 'pm_card',
        providerCustomerId: 'cust_1',
        type: 'card',
        brand: 'visa',
        last4: '4242',
        expiresMonth: 7,
        expiresYear: 2030,
      },
      {
        providerPaymentMethodId: 'pm_revolut',
        providerCustomerId: 'cust_1',
        type: 'revolut_pay',
        brand: null,
        last4: null,
        expiresMonth: null,
        expiresYear: null,
      },
    ]);
  });

  it('deletes a customer payment method without inventing idempotency support', async () => {
    const { fetch, calls } = fakeFetch({ status: 204 });
    await provider(fetch).deletePaymentMethod(
      { providerCustomerId: 'cust/1', providerPaymentMethodId: 'pm/1' },
      ctx,
    );

    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/customers/cust%2F1/payment-methods/pm%2F1',
      method: 'DELETE',
    });
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('normalizes Merchant API errors', async () => {
    const { fetch } = fakeFetch({
      status: 429,
      body: { code: 'too_many_requests', message: 'slow down' },
    });
    await expect(
      provider(fetch).listPaymentMethods({ providerCustomerId: 'cust_1' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
  });
});
