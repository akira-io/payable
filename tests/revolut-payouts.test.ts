import { describe, expect, it } from 'vitest';
import { isPayoutCapable } from '../src/domain/contracts/payment-provider.contract';
import {
  RevolutProvider,
  type RevolutProviderOptions,
} from '../src/infrastructure/providers/revolut/revolut-provider';

interface RecordedRequest {
  url: string;
  method: string;
}

function fakeFetch(...responses: unknown[]) {
  const calls: RecordedRequest[] = [];
  const fetch: NonNullable<RevolutProviderOptions['fetch']> = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    const body = responses.shift();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

const provider = (fetch: RevolutProviderOptions['fetch']) =>
  new RevolutProvider({ secretKey: 'sk_rev_test', webhookSecret: 'wsk_test', fetch });

const payout = {
  id: 'payout-1',
  state: 'completed',
  created_at: '2026-06-10T10:00:00Z',
  destination_type: 'current_pocket',
  amount: 50000,
  currency: 'GBP',
};

describe('Revolut payouts', () => {
  it('declares the optional capability', () => {
    const { fetch } = fakeFetch([]);
    const instance = provider(fetch);
    expect(instance.capabilities().has('payouts')).toBe(true);
    expect(isPayoutCapable(instance)).toBe(true);
  });

  it('lists and maps payouts within Revolut maximum limit', async () => {
    const { fetch, calls } = fakeFetch([payout]);
    const [result] = await provider(fetch).listPayouts({ limit: 600 });

    expect(calls[0]).toEqual({
      url: 'https://merchant.revolut.com/api/payouts?limit=500',
      method: 'GET',
    });
    expect(result).toMatchObject({
      providerPayoutId: 'payout-1',
      status: 'paid',
      createdAt: new Date('2026-06-10T10:00:00Z'),
      arrivalAt: null,
    });
    expect(result?.amount?.amount()).toBe(50000);
    expect(result?.amount?.currency()).toBe('GBP');
  });

  it('retrieves a payout and maps missing optional amount to null', async () => {
    const { amount: _amount, currency: _currency, ...withoutAmount } = payout;
    const { fetch, calls } = fakeFetch({ ...withoutAmount, state: 'processing' });
    const result = await provider(fetch).retrievePayout('payout/1');

    expect(calls[0]?.url).toBe('https://merchant.revolut.com/api/payouts/payout%2F1');
    expect(result.status).toBe('pending');
    expect(result.amount).toBeNull();
  });
});
