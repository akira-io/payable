import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { AccountingCapabilities } from '../src/index';
import * as PayableApi from '../src/index';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const accountingProvider = {
  name: 'example-accounting',
  capabilities: () => new Set(['categories']),
};

type AccountingProviderAccessor = {
  accountingProviders(): {
    get(name: string): typeof accountingProvider;
    names(): string[];
  };
};

describe('accounting provider foundation', () => {
  it('registers accounting providers independently', () => {
    const config = {
      providers: { payments: new FakeProvider() },
      accountingProviders: { accounting: accountingProvider },
    } as PayableConfig;
    const payable = createPayable(config) as ReturnType<typeof createPayable> &
      AccountingProviderAccessor;

    expect(payable.accountingProviders).toBeTypeOf('function');
    expect(payable.accountingProviders().get('accounting')).toBe(accountingProvider);
    expect(payable.accountingProviders().names()).toEqual(['accounting']);
  });

  it('allows configurations without accounting providers', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      AccountingProviderAccessor;

    expect(payable.accountingProviders).toBeTypeOf('function');
    expect(payable.accountingProviders().names()).toEqual([]);
  });

  it('throws an accounting-specific missing provider error', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      AccountingProviderAccessor;
    const MissingProviderError = Reflect.get(PayableApi, 'AccountingProviderNotFoundError') as new (
      ...args: unknown[]
    ) => Error;

    expect(MissingProviderError).toBeTypeOf('function');
    expect(() => payable.accountingProviders().get('missing')).toThrow(MissingProviderError);
  });

  it('allows provider-specific capability strings', () => {
    const capabilities: AccountingCapabilities = new Set(['categories', 'x-example-sync']);

    expect(capabilities.has('x-example-sync')).toBe(true);
  });

  it.each([
    [
      'isAccountingCategoryCapable',
      [
        'createAccountingCategory',
        'listAccountingCategories',
        'retrieveAccountingCategory',
        'updateAccountingCategory',
        'deleteAccountingCategory',
      ],
    ],
    [
      'isAccountingTaxRateCapable',
      [
        'createAccountingTaxRate',
        'listAccountingTaxRates',
        'retrieveAccountingTaxRate',
        'updateAccountingTaxRate',
        'deleteAccountingTaxRate',
      ],
    ],
    [
      'isAccountingLabelCapable',
      [
        'createAccountingLabel',
        'listAccountingLabels',
        'retrieveAccountingLabel',
        'updateAccountingLabel',
        'deleteAccountingLabel',
      ],
    ],
    [
      'isAccountingExpenseCapable',
      ['listAccountingExpenses', 'retrieveAccountingExpense', 'updateAccountingExpense'],
    ],
    ['isAccountingLedgerCapable', ['listAccountingLedgerEntries', 'retrieveAccountingLedgerEntry']],
  ])('requires every method for %s', (exportName, methods) => {
    const guard = Reflect.get(PayableApi, exportName) as (provider: object) => boolean;
    const complete = Object.fromEntries(methods.map((method) => [method, async () => undefined]));
    const partial = Object.fromEntries(
      methods.slice(0, -1).map((method) => [method, async () => undefined]),
    );

    expect(guard).toBeTypeOf('function');
    expect(guard({ ...accountingProvider, ...partial })).toBe(false);
    expect(guard({ ...accountingProvider, ...complete })).toBe(true);
  });
});
