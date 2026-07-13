import { describe, expect, it } from 'vitest';
import { isDisputeCapable } from '../src/domain/contracts/payment-provider.contract';
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

function fakeFetch(...responses: unknown[]) {
  const calls: RecordedRequest[] = [];
  const fetch: NonNullable<RevolutProviderOptions['fetch']> = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    const body = responses.shift();
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status: body === undefined ? 204 : 200,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function provider(
  fetch: RevolutProviderOptions['fetch'],
  environment: 'production' | 'sandbox' = 'production',
) {
  return new RevolutProvider({
    secretKey: 'sk_rev_test',
    webhookSecret: 'wsk_test',
    environment,
    fetch,
  });
}

const dispute = {
  id: 'dispute-1',
  state: 'needs_response',
  created_at: '2026-05-22T09:00:00Z',
  response_due_date: '2026-06-06T09:00:00Z',
  reason_code: '13.1',
  amount: 3000,
  currency: 'EUR',
  payment: { id: 'payment-1', order_id: 'order-1' },
};

describe('Revolut disputes', () => {
  it('declares the optional capability', () => {
    const { fetch } = fakeFetch();
    const instance = provider(fetch);
    expect(instance.capabilities().has('disputes')).toBe(true);
    expect(isDisputeCapable(instance)).toBe(true);
  });

  it('lists and maps production disputes with a bounded limit', async () => {
    const { fetch, calls } = fakeFetch([dispute]);
    const [result] = await provider(fetch).listDisputes({ limit: 25 });

    expect(calls[0]).toMatchObject({
      url: 'https://merchant.revolut.com/api/disputes?limit=25',
      method: 'GET',
    });
    expect(result).toMatchObject({
      providerDisputeId: 'dispute-1',
      providerPaymentId: 'order-1',
      status: 'needs_response',
      reason: '13.1',
      createdAt: new Date('2026-05-22T09:00:00Z'),
      responseDueAt: new Date('2026-06-06T09:00:00Z'),
    });
    expect(result?.amount.amount()).toBe(3000);
    expect(result?.amount.currency()).toBe('EUR');
  });

  it('retrieves a dispute and falls back to the payment id', async () => {
    const { fetch, calls } = fakeFetch({ ...dispute, payment: { id: 'payment-1' } });
    const result = await provider(fetch).retrieveDispute('dispute/1');

    expect(calls[0]?.url).toBe('https://merchant.revolut.com/api/disputes/dispute%2F1');
    expect(result.providerPaymentId).toBe('payment-1');
  });

  it('accepts a dispute without forwarding unsupported idempotency', async () => {
    const { fetch, calls } = fakeFetch();
    await provider(fetch).acceptDispute('dispute-1', ctx);

    expect(calls[0]).toMatchObject({
      url: 'https://merchant.revolut.com/api/disputes/dispute-1/accept',
      method: 'POST',
    });
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
  });

  it('rejects dispute operations in the sandbox before sending a request', async () => {
    const { fetch, calls } = fakeFetch([dispute]);
    await expect(provider(fetch, 'sandbox').listDisputes()).rejects.toMatchObject({
      code: 'PROVIDER_OPERATION_UNSUPPORTED',
    });
    expect(calls).toHaveLength(0);
  });
});
