import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import * as PayableApi from '../src/index';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const marketplaceProvider = {
  name: 'example-marketplace',
  capabilities: () => new Set(['accounts']),
};

type MarketplaceProviderAccessor = {
  marketplaceProviders(): {
    get(name: string): typeof marketplaceProvider;
    names(): string[];
  };
};

describe('marketplace provider foundation', () => {
  it('registers marketplace providers independently', () => {
    const config = {
      providers: { payments: new FakeProvider() },
      marketplaceProviders: { marketplace: marketplaceProvider },
    } as PayableConfig;
    const payable = createPayable(config) as ReturnType<typeof createPayable> &
      MarketplaceProviderAccessor;

    expect(payable.marketplaceProviders).toBeTypeOf('function');
    expect(payable.marketplaceProviders().get('marketplace')).toBe(marketplaceProvider);
    expect(payable.marketplaceProviders().names()).toEqual(['marketplace']);
  });

  it('allows configurations without marketplace providers', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      MarketplaceProviderAccessor;

    expect(payable.marketplaceProviders).toBeTypeOf('function');
    expect(payable.marketplaceProviders().names()).toEqual([]);
  });

  it('throws a marketplace-specific missing provider error', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      MarketplaceProviderAccessor;
    const MissingProviderError = Reflect.get(
      PayableApi,
      'MarketplaceProviderNotFoundError',
    ) as new (
      ...args: unknown[]
    ) => Error;

    expect(MissingProviderError).toBeTypeOf('function');
    expect(() => payable.marketplaceProviders().get('missing')).toThrow(MissingProviderError);
  });

  it.each([
    [
      'isMarketplaceAccountCapable',
      ['createMarketplaceAccount', 'retrieveMarketplaceAccount', 'listMarketplaceAccounts'],
    ],
    ['isMarketplaceOnboardingCapable', ['createMarketplaceOnboardingLink']],
    [
      'isMarketplaceTransferCapable',
      ['createMarketplaceTransfer', 'listMarketplaceTransfers', 'retrieveMarketplaceTransfer'],
    ],
    [
      'isMarketplacePayoutCapable',
      ['createMarketplacePayout', 'listMarketplacePayouts', 'retrieveMarketplacePayout'],
    ],
  ])('requires every method for %s', (exportName, methods) => {
    const guard = Reflect.get(PayableApi, exportName) as (provider: object) => boolean;
    const complete = Object.fromEntries(methods.map((method) => [method, async () => undefined]));
    const partial = Object.fromEntries(
      methods.slice(0, -1).map((method) => [method, async () => undefined]),
    );

    expect(guard).toBeTypeOf('function');
    expect(guard({ ...marketplaceProvider, ...partial })).toBe(false);
    expect(guard({ ...marketplaceProvider, ...complete })).toBe(true);
  });
});
