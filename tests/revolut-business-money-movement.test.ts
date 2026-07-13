import { describe, expect, it } from 'vitest';
import type {
  TreasuryCounterpartyCapable,
  TreasuryExchangeCapable,
  TreasuryProvider,
  TreasuryTransferCapable,
} from '../src/domain/contracts/treasury-provider.contract';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import { Money } from '../src/domain/value-objects/money';
import * as PayableApi from '../src/index';
import {
  businessCounterparty,
  businessTransaction,
  exchangeQuote,
  exchangeResponse,
  fakeRevolutBusinessFetch,
  transferResponse,
} from './support/revolut-business';

interface BusinessProviderOptions {
  tokenProvider: { getAccessToken(): string | Promise<string> };
  environment?: 'sandbox' | 'production';
  fetch?: typeof globalThis.fetch;
}

type BusinessMoneyProvider = TreasuryProvider &
  TreasuryTransferCapable &
  TreasuryCounterpartyCapable &
  TreasuryExchangeCapable;
type BusinessProviderConstructor = new (options: BusinessProviderOptions) => BusinessMoneyProvider;

function provider(fetch: typeof globalThis.fetch): BusinessMoneyProvider {
  const Constructor = Reflect.get(
    PayableApi,
    'RevolutBusinessTreasuryProvider',
  ) as BusinessProviderConstructor;
  expect(Constructor).toBeTypeOf('function');
  return new Constructor({
    tokenProvider: { getAccessToken: () => 'business-token' },
    environment: 'sandbox',
    fetch,
  });
}

const context: OperationContext = { correlationId: 'corr-1', idempotencyKey: 'request-1' };

describe('Revolut Business money movement', () => {
  it('moves money between business accounts using the idempotency key as request id', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch({ body: transferResponse });
    const mapped = await provider(fetch).createTreasuryTransfer(
      {
        sourceProviderAccountId: 'account-1',
        destination: { type: 'account', providerAccountId: 'account-2' },
        amount: Money.of(1025, 'GBP'),
        reference: 'Reserve allocation',
      },
      context,
    );

    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-b2b.revolut.com/api/1.0/transfer',
      method: 'POST',
      body: {
        request_id: 'request-1',
        source_account_id: 'account-1',
        target_account_id: 'account-2',
        amount: 10.25,
        currency: 'GBP',
        reference: 'Reserve allocation',
      },
    });
    expect(mapped).toMatchObject({
      providerTransferId: 'transfer-1',
      status: 'completed',
      destination: { type: 'account', providerAccountId: 'account-2' },
    });
  });

  it('pays an existing counterparty and rejects unsupported PaymentMethod destinations', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch({ body: transferResponse });
    const instance = provider(fetch);
    await instance.createTreasuryTransfer(
      {
        sourceProviderAccountId: 'account-1',
        destination: {
          type: 'counterparty',
          providerCounterpartyId: 'counterparty-1',
          providerAccountId: 'counterparty-account-1',
        },
        amount: Money.of(1025, 'GBP'),
      },
      context,
    );

    expect(calls[0]?.url).toBe('https://sandbox-b2b.revolut.com/api/1.0/pay');
    expect(calls[0]?.body).toMatchObject({
      request_id: 'request-1',
      account_id: 'account-1',
      receiver: {
        counterparty_id: 'counterparty-1',
        account_id: 'counterparty-account-1',
      },
    });
    await expect(
      instance.createTreasuryTransfer(
        {
          sourceProviderAccountId: 'account-1',
          destination: { type: 'payment_method', providerPaymentMethodId: 'card-1' },
          amount: Money.of(1025, 'GBP'),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TREASURY_DESTINATION_UNSUPPORTED' });
    expect(calls).toHaveLength(1);
  });

  it('lists and retrieves outbound transfer transactions', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: [businessTransaction] },
      { body: businessTransaction },
    );
    const instance = provider(fetch);
    const listed = await instance.listTreasuryTransfers({
      providerAccountId: 'account-1',
      limit: 10,
    });
    const retrieved = await instance.retrieveTreasuryTransfer('transaction-1');

    const listUrl = new URL(calls[0]?.url ?? '');
    expect(Object.fromEntries(listUrl.searchParams)).toMatchObject({
      account: 'account-1',
      type: 'transfer',
      count: '10',
    });
    expect(listed[0]?.amount.amount()).toBe(1025);
    expect(listed[0]?.destination).toMatchObject({
      type: 'counterparty',
      providerCounterpartyId: 'counterparty-1',
    });
    expect(retrieved.providerTransferId).toBe('transaction-1');
  });

  it('lists and retrieves normalized counterparties', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: [businessCounterparty] },
      { body: businessCounterparty },
    );
    const instance = provider(fetch);
    const [listed] = await instance.listTreasuryCounterparties({ limit: 20 });
    const retrieved = await instance.retrieveTreasuryCounterparty('counterparty/1');

    expect(calls[0]?.url).toBe('https://sandbox-b2b.revolut.com/api/1.0/counterparties?limit=20');
    expect(listed).toMatchObject({ providerCounterpartyId: 'counterparty-1', status: 'created' });
    expect(listed?.accounts[0]).toMatchObject({
      providerAccountId: 'counterparty-account-1',
      currency: 'GBP',
      country: 'GB',
    });
    expect(retrieved.name).toBe('Vendor Ltd');
  });

  it('quotes and executes currency exchange with body-level idempotency', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: exchangeQuote },
      { body: exchangeResponse },
    );
    const instance = provider(fetch);
    const quote = await instance.quoteTreasuryExchange({
      sourceAmount: Money.of(1025, 'GBP'),
      targetCurrency: 'EUR',
    });
    const exchange = await instance.createTreasuryExchange(
      {
        sourceProviderAccountId: 'account-1',
        targetProviderAccountId: 'account-2',
        sourceCurrency: 'GBP',
        targetCurrency: 'EUR',
        sourceAmount: Money.of(1025, 'GBP'),
        reference: 'Monthly conversion',
      },
      context,
    );

    expect(calls[0]?.url).toBe(
      'https://sandbox-b2b.revolut.com/api/1.0/rate?from=GBP&to=EUR&amount=10.25',
    );
    expect(quote.targetAmount.amount()).toBe(1291);
    expect(quote.fee?.amount()).toBe(5);
    expect(calls[1]?.body).toEqual({
      from: { account_id: 'account-1', currency: 'GBP', amount: 10.25 },
      to: { account_id: 'account-2', currency: 'EUR' },
      request_id: 'request-1',
      reference: 'Monthly conversion',
    });
    expect(exchange).toMatchObject({ providerTransactionId: 'exchange-1', status: 'completed' });
  });

  it('hashes request identifiers longer than the Business API limit', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch({ body: transferResponse });
    await provider(fetch).createTreasuryTransfer(
      {
        sourceProviderAccountId: 'account-1',
        destination: { type: 'account', providerAccountId: 'account-2' },
        amount: Money.of(100, 'GBP'),
      },
      { correlationId: 'corr-1', idempotencyKey: 'x'.repeat(41) },
    );

    expect((calls[0]?.body as { request_id: string }).request_id).toHaveLength(40);
    expect((calls[0]?.body as { request_id: string }).request_id).not.toContain('x'.repeat(40));
  });

  it('rejects an exchange amount whose currency does not match the declared leg', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch();

    await expect(
      provider(fetch).createTreasuryExchange(
        {
          sourceProviderAccountId: 'account-1',
          targetProviderAccountId: 'account-2',
          sourceCurrency: 'GBP',
          targetCurrency: 'EUR',
          sourceAmount: Money.of(1025, 'USD'),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    expect(calls).toHaveLength(0);
  });
});
