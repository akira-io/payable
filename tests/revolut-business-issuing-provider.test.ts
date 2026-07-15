import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  isIssuingAuthorizationCapable,
  isIssuingCardCapable,
  isIssuingCardholderCapable,
  isIssuingTransactionCapable,
} from '../src/domain/contracts/issuing-provider.contract';
import { Money } from '../src/domain/value-objects/money';
import { RevolutBusinessIssuingProvider } from '../src/infrastructure/providers/revolut/revolut-business-issuing-provider';
import { fakeRevolutBusinessFetch } from './support/revolut-business';

const context = { correlationId: 'corr-1', idempotencyKey: 'card-request-1' };

const card = {
  id: 'card-1',
  holder_id: 'member-1',
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:01:00Z',
  virtual: true,
  last_digits: '2671',
  expiry: '09/2030',
  label: 'Travel',
  state: 'active',
  product: { scheme: 'Visa' },
  accounts: ['account-1'],
};

const cardTransaction = {
  id: 'transaction-1',
  type: 'card_payment',
  state: 'completed',
  created_at: '2026-07-02T10:00:00Z',
  updated_at: '2026-07-02T10:01:00Z',
  card: { id: 'card-1' },
  legs: [{ leg_id: 'leg-1', account_id: 'account-1', amount: -12.34, currency: 'GBP' }],
};

function provider(fetch: typeof globalThis.fetch) {
  return new RevolutBusinessIssuingProvider({
    tokenProvider: { getAccessToken: () => 'token-1' },
    fetch,
  });
}

describe('Revolut Business Issuing provider', () => {
  it('advertises only cards and issuing transactions without exposing tokens', () => {
    const { fetch } = fakeRevolutBusinessFetch();
    const instance = provider(fetch);

    expect(instance.capabilities()).toEqual(new Set(['cards', 'transactions']));
    expect(isIssuingCardCapable(instance)).toBe(true);
    expect(isIssuingTransactionCapable(instance)).toBe(true);
    expect(isIssuingCardholderCapable(instance)).toBe(false);
    expect(isIssuingAuthorizationCapable(instance)).toBe(false);
    const tokenProvider = { secret: 'access-token-secret', getAccessToken: () => 'token-1' };
    const configured = new RevolutBusinessIssuingProvider({
      tokenProvider,
    });
    expect(JSON.stringify(configured)).not.toContain('access-token-secret');
    expect(inspect(configured)).not.toContain('access-token-secret');
  });

  it('creates only virtual cards with request id and generic controls', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch({ body: card });
    const instance = provider(fetch);

    const created = await instance.createIssuingCard(
      {
        holderReference: 'member-1',
        form: 'virtual',
        label: 'Travel',
        spendingLimit: Money.of(20_022, 'GBP'),
      },
      context,
    );

    expect(calls[0]).toMatchObject({
      url: 'https://b2b.revolut.com/api/1.0/cards',
      method: 'POST',
      body: {
        request_id: 'card-request-1',
        holder_id: 'member-1',
        virtual: true,
        label: 'Travel',
        spending_limits: { single: { amount: 200.22, currency: 'GBP' } },
      },
    });
    expect(created).toMatchObject({
      providerCardId: 'card-1',
      providerCardholderId: 'member-1',
      form: 'virtual',
      lastFour: '2671',
      expiryMonth: 9,
      expiryYear: 2030,
    });
  });

  it('rejects physical cards before making an HTTP request', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch();

    await expect(
      provider(fetch).createIssuingCard(
        { holderReference: 'member-1', form: 'physical', currency: 'GBP' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_OPERATION_UNSUPPORTED' });
    expect(calls).toHaveLength(0);
  });

  it('paginates card reads with created_before and retrieves a card', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...card,
      id: `card-${index + 1}`,
      created_at: new Date(Date.UTC(2026, 6, 2, 0, 0, 100 - index)).toISOString(),
    }));
    const lastCard = { ...card, id: 'card-101', created_at: '2026-07-01T00:00:00.000Z' };
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: firstPage },
      { body: [lastCard] },
      { body: card },
    );
    const instance = provider(fetch);

    const cards = await instance.listIssuingCards({ limit: 101 });
    const retrieved = await instance.retrieveIssuingCard('card/1');

    expect(new URL(calls[0]?.url ?? '').searchParams.get('limit')).toBe('100');
    const secondUrl = new URL(calls[1]?.url ?? '');
    expect(secondUrl.searchParams.get('limit')).toBe('1');
    expect(secondUrl.searchParams.get('created_before')).toBe(firstPage[99]?.created_at);
    expect(calls[2]?.url).toBe('https://b2b.revolut.com/api/1.0/cards/card%2F1');
    expect(cards).toHaveLength(101);
    expect(retrieved.brand).toBe('Visa');
  });

  it.each([
    ['inactive', 'active', 'freeze', 'frozen'],
    ['active', 'frozen', 'unfreeze', 'active'],
    ['blocked', 'active', 'lock', 'locked'],
    ['active', 'locked', 'unlock', 'active'],
  ] as const)('maps %s card status through %s', async (target, current, operation, result) => {
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: { ...card, state: current } },
      {},
      { body: { ...card, state: result } },
    );

    const updated = await provider(fetch).updateIssuingCardStatus('card-1', target, context);

    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'GET']);
    expect(calls[1]?.url).toBe(`https://b2b.revolut.com/api/1.0/cards/card-1/${operation}`);
    expect(updated.status).toBe(target);
  });

  it('terminates cards without trying to retrieve deleted details', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch({ body: card }, {});

    const terminated = await provider(fetch).updateIssuingCardStatus('card-1', 'canceled', context);

    expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE']);
    expect(calls[1]?.url).toBe('https://b2b.revolut.com/api/1.0/cards/card-1');
    expect(terminated.status).toBe('canceled');
  });

  it('keeps paging past pages with no matching card transactions', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...cardTransaction,
      id: `other-${index}`,
      card: { id: 'other-card' },
      created_at: new Date(Date.UTC(2026, 6, 2, 0, 0, 40 - index)).toISOString(),
    }));
    const match = {
      ...cardTransaction,
      id: 'transaction-late',
      created_at: '2026-07-01T00:00:00.000Z',
    };
    const { fetch, calls } = fakeRevolutBusinessFetch({ body: firstPage }, { body: [match] });

    const transactions = await provider(fetch).listIssuingTransactions({
      providerCardId: 'card-1',
      limit: 20,
    });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.providerTransactionId).toBe('transaction-late');
    const secondUrl = new URL(calls[1]?.url ?? '');
    expect(secondUrl.searchParams.get('to')).toBe(firstPage[19]?.created_at);
  });

  it('stops paging when the cursor repeats instead of looping forever', async () => {
    const stuckPage = Array.from({ length: 20 }, (_, index) => ({
      ...cardTransaction,
      id: `stuck-${index}`,
      card: { id: 'other-card' },
      created_at: '2026-07-01T00:00:00.000Z',
    }));
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: stuckPage },
      { body: stuckPage },
      { body: stuckPage },
    );

    const transactions = await provider(fetch).listIssuingTransactions({
      providerCardId: 'card-1',
      limit: 20,
    });

    expect(transactions).toHaveLength(0);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('reads and filters normalized card transactions', async () => {
    const refund = {
      ...cardTransaction,
      id: 'transaction-2',
      type: 'card_payment_refund',
      legs: [{ ...cardTransaction.legs[0], amount: 5 }],
    };
    const reversal = { ...cardTransaction, id: 'transaction-3', state: 'reverted' };
    const unrelated = { ...cardTransaction, id: 'transaction-4', card: { id: 'other-card' } };
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: [cardTransaction, refund, reversal, unrelated] },
      { body: cardTransaction },
    );
    const instance = provider(fetch);

    const transactions = await instance.listIssuingTransactions({
      providerCardId: 'card-1',
      limit: 20,
    });
    const retrieved = await instance.retrieveIssuingTransaction('transaction/1');

    expect(new URL(calls[0]?.url ?? '').searchParams.get('count')).toBe('20');
    expect(transactions.map((transaction) => transaction.type)).toEqual([
      'capture',
      'refund',
      'reversal',
    ]);
    expect(transactions[0]?.amount.amount()).toBe(-1234);
    expect(retrieved.providerCardId).toBe('card-1');
    expect(calls[1]?.url).toBe('https://b2b.revolut.com/api/1.0/transaction/transaction%2F1');
    expect(calls.every((call) => !call.url.includes('sensitive-details'))).toBe(true);
  });

  it('normalizes errors under the issuing provider name', async () => {
    const { fetch } = fakeRevolutBusinessFetch({
      status: 401,
      body: { code: 1001, message: 'Authentication failed' },
    });

    await expect(provider(fetch).retrieveIssuingCard('missing')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      context: { provider: 'revolut-business-issuing', revolutCode: '1001', status: 401 },
    });
  });

  it('rejects unsupported authorization filters before making an HTTP request', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch();

    await expect(
      provider(fetch).listIssuingTransactions({ providerAuthorizationId: 'authorization-1' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_OPERATION_UNSUPPORTED' });
    expect(calls).toHaveLength(0);
  });
});
