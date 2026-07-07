import { describe, expect, it } from 'vitest';
import type { CustomerCapable } from '../src/domain/contracts/payment-provider.contract';
import { isCustomerCapable } from '../src/domain/contracts/payment-provider.contract';
import {
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

function provider(fetch: RevolutProviderOptions['fetch']): RevolutProvider & CustomerCapable {
  const instance = new RevolutProvider({
    secretKey: 'sk_rev_test',
    webhookSecret: 'wsk_test',
    environment: 'sandbox',
    fetch,
  });
  if (!isCustomerCapable(instance)) {
    throw new Error('RevolutProvider must implement CustomerCapable');
  }
  return instance;
}

function customer() {
  return {
    id: 'cust_1',
    email: 'jane@example.com',
    full_name: 'Jane Doe',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    payment_methods: [],
  };
}

describe('RevolutProvider customers', () => {
  it('advertises and implements the generic customer capability', () => {
    const instance = new RevolutProvider({ secretKey: 'sk_rev_test', webhookSecret: 'wsk_test' });
    expect(instance.capabilities().has('customers')).toBe(true);
    expect(isCustomerCapable(instance)).toBe(true);
  });

  it('creates a Merchant customer without inventing idempotency support', async () => {
    const { fetch, calls } = fakeFetch({ status: 201, body: customer() });

    const dto = await provider(fetch).createCustomer(
      {
        billableType: 'User',
        billableId: '1',
        email: 'jane@example.com',
        name: 'Jane Doe',
        metadata: { ignored: 'true' },
      },
      ctx,
    );

    expect(dto).toEqual({
      providerCustomerId: 'cust_1',
      email: 'jane@example.com',
      name: 'Jane Doe',
    });
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/customers',
      method: 'POST',
      body: { email: 'jane@example.com', full_name: 'Jane Doe' },
    });
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('updates a Merchant customer by provider customer id', async () => {
    const { fetch, calls } = fakeFetch({
      status: 200,
      body: { ...customer(), email: 'updated@example.com', full_name: 'Jane Updated' },
    });

    const dto = await provider(fetch).updateCustomer(
      {
        providerCustomerId: 'cust_1',
        email: 'updated@example.com',
        name: 'Jane Updated',
      },
      ctx,
    );

    expect(dto).toEqual({
      providerCustomerId: 'cust_1',
      email: 'updated@example.com',
      name: 'Jane Updated',
    });
    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/customers/cust_1',
      method: 'PATCH',
      body: { email: 'updated@example.com', full_name: 'Jane Updated' },
    });
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
  });
});
