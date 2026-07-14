import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import * as PayableApi from '../src/index';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const taxProvider = {
  name: 'example-tax',
  capabilities: () => new Set(['calculations']),
};

type TaxProviderAccessor = {
  taxProviders(): {
    get(name: string): typeof taxProvider;
    names(): string[];
  };
};

describe('tax provider foundation', () => {
  it('exposes an independent tax provider registry', () => {
    const config = {
      providers: { payments: new FakeProvider() },
      taxProviders: { tax: taxProvider },
    } as PayableConfig;
    const payable = createPayable(config) as ReturnType<typeof createPayable> & TaxProviderAccessor;

    expect(payable.taxProviders).toBeTypeOf('function');
    expect(payable.taxProviders().get('tax')).toBe(taxProvider);
    expect(payable.taxProviders().names()).toEqual(['tax']);
  });

  it('allows payment-only configurations', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      TaxProviderAccessor;

    expect(payable.taxProviders).toBeTypeOf('function');
    expect(payable.taxProviders().names()).toEqual([]);
  });

  it('throws a tax-specific error for an unknown tax provider', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      TaxProviderAccessor;
    const TaxProviderNotFoundError = Reflect.get(PayableApi, 'TaxProviderNotFoundError') as new (
      ...args: unknown[]
    ) => Error;

    expect(TaxProviderNotFoundError).toBeTypeOf('function');
    expect(() => payable.taxProviders().get('missing')).toThrow(TaxProviderNotFoundError);
  });

  it.each([
    ['isTaxCalculationCapable', ['calculateTax', 'retrieveTaxCalculation']],
    ['isTaxTransactionCapable', ['commitTaxTransaction', 'reverseTaxTransaction']],
  ])('requires every method for %s', (exportName, methods) => {
    const guard = Reflect.get(PayableApi, exportName) as (provider: object) => boolean;
    const complete = Object.fromEntries(methods.map((method) => [method, async () => undefined]));
    const partial = Object.fromEntries(
      methods.slice(0, -1).map((method) => [method, async () => undefined]),
    );

    expect(guard).toBeTypeOf('function');
    expect(guard({ ...taxProvider, ...partial })).toBe(false);
    expect(guard({ ...taxProvider, ...complete })).toBe(true);
  });
});
