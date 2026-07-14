import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import * as PayableApi from '../src/index';
import { RevolutBusinessTreasuryProvider } from '../src/infrastructure/providers/revolut/revolut-business-treasury-provider';
import { StripeTreasuryProvider } from '../src/infrastructure/providers/stripe/stripe-treasury-provider';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const treasuryProvider = {
  name: 'example-treasury',
  capabilities: () => new Set(['accounts']),
};

describe('treasury provider foundation', () => {
  it('exposes an independent treasury provider registry', () => {
    const config = {
      providers: { payments: new FakeProvider() },
      treasuryProviders: { treasury: treasuryProvider },
    } as PayableConfig;
    const payable = createPayable(config) as ReturnType<typeof createPayable> & {
      treasuryProviders(): {
        get(name: string): typeof treasuryProvider;
        names(): string[];
      };
    };

    expect(payable.treasuryProviders().get('treasury')).toBe(treasuryProvider);
    expect(payable.treasuryProviders().names()).toEqual(['treasury']);
    expect(payable.providers().names()).toEqual(['payments']);
  });

  it('allows payment-only configurations', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > & {
      treasuryProviders(): { names(): string[] };
    };

    expect(payable.treasuryProviders().names()).toEqual([]);
  });

  it('throws a treasury-specific error for an unknown treasury provider', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > & {
      treasuryProviders(): { get(name: string): unknown };
    };
    const TreasuryProviderNotFoundError = Reflect.get(
      PayableApi,
      'TreasuryProviderNotFoundError',
    ) as new (
      ...args: unknown[]
    ) => Error;

    expect(TreasuryProviderNotFoundError).toBeTypeOf('function');
    expect(() => payable.treasuryProviders().get('missing')).toThrow(TreasuryProviderNotFoundError);
  });

  it.each([
    ['isTreasuryAccountCapable', ['listTreasuryAccounts', 'retrieveTreasuryAccount']],
    ['isTreasuryTransactionCapable', ['listTreasuryTransactions', 'retrieveTreasuryTransaction']],
    [
      'isTreasuryTransferCapable',
      ['createTreasuryTransfer', 'listTreasuryTransfers', 'retrieveTreasuryTransfer'],
    ],
    [
      'isTreasuryCounterpartyCapable',
      ['listTreasuryCounterparties', 'retrieveTreasuryCounterparty'],
    ],
    ['isTreasuryExchangeCapable', ['quoteTreasuryExchange', 'createTreasuryExchange']],
    ['isTreasuryWebhookCapable', ['verifyTreasuryWebhook']],
  ])('requires every method for %s', (exportName, methods) => {
    const guard = Reflect.get(PayableApi, exportName) as (provider: object) => boolean;
    const complete = Object.fromEntries(methods.map((method) => [method, async () => undefined]));
    const partial = Object.fromEntries(
      methods.slice(0, -1).map((method) => [method, async () => undefined]),
    );

    expect(guard).toBeTypeOf('function');
    expect(guard({ ...treasuryProvider, ...partial })).toBe(false);
    expect(guard({ ...treasuryProvider, ...complete })).toBe(true);
  });

  it('advertises Treasury webhooks only for providers with a complete adapter', () => {
    const stripe = new StripeTreasuryProvider({
      secretKey: 'sk_test',
      connectedAccountId: 'acct_1',
    });
    const revolut = new RevolutBusinessTreasuryProvider({
      tokenProvider: { getAccessToken: async () => 'access-token' },
    });

    expect(stripe.capabilities().has('webhooks')).toBe(true);
    expect(PayableApi.isTreasuryWebhookCapable(stripe)).toBe(true);
    expect(revolut.capabilities().has('webhooks')).toBe(false);
  });
});
