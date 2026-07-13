import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type {
  TreasuryAccountCapable,
  TreasuryProvider,
  TreasuryTransactionCapable,
} from '../src/domain/contracts/treasury-provider.contract';
import {
  isTreasuryAccountCapable,
  isTreasuryCounterpartyCapable,
  isTreasuryExchangeCapable,
  isTreasuryTransactionCapable,
  isTreasuryTransferCapable,
} from '../src/domain/contracts/treasury-provider.contract';
import * as PayableApi from '../src/index';
import {
  businessAccount,
  businessTransaction,
  fakeRevolutBusinessFetch,
} from './support/revolut-business';

interface BusinessProviderOptions {
  tokenProvider: { getAccessToken(): string | Promise<string> };
  environment?: 'sandbox' | 'production';
  fetch?: typeof globalThis.fetch;
}

type BusinessProvider = TreasuryProvider & TreasuryAccountCapable & TreasuryTransactionCapable;
type BusinessProviderConstructor = new (options: BusinessProviderOptions) => BusinessProvider;

function provider(
  fetch: typeof globalThis.fetch,
  tokenProvider: BusinessProviderOptions['tokenProvider'] = { getAccessToken: () => 'token-1' },
): BusinessProvider {
  const Constructor = Reflect.get(
    PayableApi,
    'RevolutBusinessTreasuryProvider',
  ) as BusinessProviderConstructor;
  expect(Constructor).toBeTypeOf('function');
  return new Constructor({ tokenProvider, environment: 'sandbox', fetch });
}

describe('Revolut Business Treasury provider', () => {
  it('declares every supported Business Treasury capability', () => {
    const { fetch } = fakeRevolutBusinessFetch();
    const instance = provider(fetch);

    expect(instance.capabilities()).toEqual(
      new Set(['accounts', 'transactions', 'transfers', 'counterparties', 'exchange']),
    );
    expect(isTreasuryAccountCapable(instance)).toBe(true);
    expect(isTreasuryTransactionCapable(instance)).toBe(true);
    expect(isTreasuryTransferCapable(instance)).toBe(true);
    expect(isTreasuryCounterpartyCapable(instance)).toBe(true);
    expect(isTreasuryExchangeCapable(instance)).toBe(true);
  });

  it('does not expose the token provider when serialized or inspected', () => {
    const { fetch } = fakeRevolutBusinessFetch();
    const tokenProvider = { token: 'business-access-secret', getAccessToken: () => 'token-1' };
    const instance = provider(fetch, tokenProvider);

    expect(JSON.stringify(instance)).not.toContain('business-access-secret');
    expect(inspect(instance)).not.toContain('business-access-secret');
  });

  it('resolves a fresh bearer token for each account request and maps major-unit balances', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: [businessAccount] },
      { body: businessAccount },
    );
    let tokenNumber = 0;
    const instance = provider(fetch, {
      getAccessToken: () => {
        tokenNumber += 1;
        return `token-${tokenNumber}`;
      },
    });

    const [listed] = await instance.listTreasuryAccounts({ limit: 1 });
    const retrieved = await instance.retrieveTreasuryAccount('account/1');

    expect(listed?.balances[0]?.current.amount()).toBe(317189);
    expect(listed?.balances[0]?.available).toBeNull();
    expect(retrieved.status).toBe('open');
    expect(calls[0]?.url).toBe('https://sandbox-b2b.revolut.com/api/1.0/accounts');
    expect(calls[1]?.url).toBe('https://sandbox-b2b.revolut.com/api/1.0/accounts/account%2F1');
    expect(calls[0]?.headers.authorization).toBe('Bearer token-1');
    expect(calls[1]?.headers.authorization).toBe('Bearer token-2');
  });

  it('lists and retrieves normalized account transactions', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: [businessTransaction] },
      { body: businessTransaction },
    );
    const instance = provider(fetch);
    const [listed] = await instance.listTreasuryTransactions({
      providerAccountId: 'account-1',
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-07-01T00:00:00Z'),
      limit: 25,
    });
    const retrieved = await instance.retrieveTreasuryTransaction('transaction/1');

    const listUrl = new URL(calls[0]?.url ?? '');
    expect(listUrl.pathname).toBe('/api/1.0/transactions');
    expect(Object.fromEntries(listUrl.searchParams)).toMatchObject({
      account: 'account-1',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
      count: '25',
    });
    expect(listed).toMatchObject({ status: 'completed', type: 'transfer' });
    expect(listed?.legs[0]?.amount.amount()).toBe(-1025);
    expect(listed?.legs[0]?.fee?.amount()).toBe(15);
    expect(retrieved.providerTransactionId).toBe('transaction-1');
    expect(calls[1]?.url).toBe(
      'https://sandbox-b2b.revolut.com/api/1.0/transaction/transaction%2F1',
    );
  });

  it('normalizes Business API authentication errors', async () => {
    const { fetch } = fakeRevolutBusinessFetch({
      status: 401,
      body: { code: 1001, message: 'Authentication failed' },
    });

    await expect(provider(fetch).listTreasuryAccounts()).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      context: { provider: 'revolut-business-treasury', revolutCode: '1001', status: 401 },
    });
  });

  it('rejects an empty access token before making an HTTP request', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch();

    await expect(
      provider(fetch, { getAccessToken: () => '  ' }).listTreasuryAccounts(),
    ).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      context: { provider: 'revolut-business-treasury' },
    });
    expect(calls).toHaveLength(0);
  });
});
