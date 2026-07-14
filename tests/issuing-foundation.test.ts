import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import * as PayableApi from '../src/index';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const issuingProvider = {
  name: 'example-issuing',
  capabilities: () => new Set(['cards']),
};

type IssuingProviderAccessor = {
  issuingProviders(): {
    get(name: string): typeof issuingProvider;
    names(): string[];
  };
};

describe('issuing provider foundation', () => {
  it('registers issuing providers independently', () => {
    const config = {
      providers: { payments: new FakeProvider() },
      issuingProviders: { issuing: issuingProvider },
    } as PayableConfig;
    const payable = createPayable(config) as ReturnType<typeof createPayable> &
      IssuingProviderAccessor;

    expect(payable.issuingProviders).toBeTypeOf('function');
    expect(payable.issuingProviders().get('issuing')).toBe(issuingProvider);
    expect(payable.issuingProviders().names()).toEqual(['issuing']);
  });

  it('allows configurations without issuing providers', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      IssuingProviderAccessor;

    expect(payable.issuingProviders).toBeTypeOf('function');
    expect(payable.issuingProviders().names()).toEqual([]);
  });

  it('throws an issuing-specific missing provider error', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      IssuingProviderAccessor;
    const MissingProviderError = Reflect.get(PayableApi, 'IssuingProviderNotFoundError') as new (
      ...args: unknown[]
    ) => Error;

    expect(MissingProviderError).toBeTypeOf('function');
    expect(() => payable.issuingProviders().get('missing')).toThrow(MissingProviderError);
  });

  it.each([
    ['isIssuingCardholderCapable', ['createIssuingCardholder', 'retrieveIssuingCardholder']],
    [
      'isIssuingCardCapable',
      ['createIssuingCard', 'listIssuingCards', 'retrieveIssuingCard', 'updateIssuingCardStatus'],
    ],
    [
      'isIssuingAuthorizationCapable',
      ['listIssuingAuthorizations', 'retrieveIssuingAuthorization', 'respondIssuingAuthorization'],
    ],
    ['isIssuingTransactionCapable', ['listIssuingTransactions', 'retrieveIssuingTransaction']],
  ])('requires every method for %s', (exportName, methods) => {
    const guard = Reflect.get(PayableApi, exportName) as (provider: object) => boolean;
    const complete = Object.fromEntries(methods.map((method) => [method, async () => undefined]));
    const partial = Object.fromEntries(
      methods.slice(0, -1).map((method) => [method, async () => undefined]),
    );

    expect(guard).toBeTypeOf('function');
    expect(guard({ ...issuingProvider, ...partial })).toBe(false);
    expect(guard({ ...issuingProvider, ...complete })).toBe(true);
  });
});
