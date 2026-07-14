import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  isAccountingCategoryCapable,
  isAccountingExpenseCapable,
  isAccountingExpenseReadCapable,
  isAccountingLabelCapable,
  isAccountingLedgerCapable,
  isAccountingTaxRateCapable,
} from '../src/domain/contracts/accounting-provider.contract';
import { isTaxCalculationCapable } from '../src/domain/contracts/tax-provider.contract';
import { RevolutBusinessAccountingProvider } from '../src/infrastructure/providers/revolut/revolut-accounting-provider';
import {
  accountingCategory,
  accountingLabel,
  accountingLabelGroup,
  accountingTaxRate,
} from './support/revolut-accounting';
import { fakeRevolutBusinessFetch } from './support/revolut-business';

const context = { correlationId: 'corr-1', idempotencyKey: 'accounting-request-1' };

function provider(fetch: typeof globalThis.fetch) {
  return new RevolutBusinessAccountingProvider({
    tokenProvider: { getAccessToken: () => 'token-1' },
    fetch,
  });
}

describe('Revolut Business Accounting settings', () => {
  it('advertises only honest accounting capabilities without credentials', () => {
    const { fetch } = fakeRevolutBusinessFetch();
    const instance = provider(fetch);
    const tokenProvider = {
      secret: 'accounting-access-secret',
      getAccessToken: () => 'token-1',
    };
    const configured = new RevolutBusinessAccountingProvider({
      tokenProvider,
    });

    expect(instance.capabilities()).toEqual(
      new Set(['categories', 'taxRates', 'labels', 'expenseReads']),
    );
    expect(isAccountingCategoryCapable(instance)).toBe(true);
    expect(isAccountingTaxRateCapable(instance)).toBe(true);
    expect(isAccountingLabelCapable(instance)).toBe(true);
    expect(isAccountingExpenseReadCapable(instance)).toBe(true);
    expect(isAccountingExpenseCapable(instance)).toBe(false);
    expect(isAccountingLedgerCapable(instance)).toBe(false);
    expect(isTaxCalculationCapable(instance as never)).toBe(false);
    expect(JSON.stringify(configured)).not.toContain('accounting-access-secret');
    expect(inspect(configured)).not.toContain('accounting-access-secret');
  });

  it('creates, paginates, retrieves, updates, and deletes categories', async () => {
    const second = { ...accountingCategory, id: 'category-2', code: 'MEAL' };
    const updated = { ...accountingCategory, name: 'Business travel' };
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: { id: 'category-1' } },
      { body: accountingCategory },
      { body: { accounting_categories: [accountingCategory], next_page_token: 'next-category' } },
      { body: { accounting_categories: [second] } },
      { body: accountingCategory },
      {},
      { body: updated },
      {},
    );
    const instance = provider(fetch);

    const created = await instance.createAccountingCategory(
      { name: 'Travel', code: 'TRV', providerDefaultTaxRateId: 'tax-1' },
      context,
    );
    const listed = await instance.listAccountingCategories({ limit: 2 });
    const retrieved = await instance.retrieveAccountingCategory('category/1');
    const changed = await instance.updateAccountingCategory(
      { providerCategoryId: 'category-1', name: 'Business travel' },
      context,
    );
    await instance.deleteAccountingCategory('category-1', context);

    expect(calls[0]).toMatchObject({
      url: 'https://b2b.revolut.com/api/1.0/accounting-categories',
      method: 'POST',
      body: { name: 'Travel', code: 'TRV', default_tax_rate_id: 'tax-1' },
    });
    expect(calls[0]?.body).not.toHaveProperty('request_id');
    expect(calls[1]?.url).toMatch(/accounting-categories\/category-1$/);
    expect(new URL(calls[2]?.url ?? '').searchParams.get('limit')).toBe('2');
    expect(new URL(calls[3]?.url ?? '').searchParams.get('page_token')).toBe('next-category');
    expect(calls[4]?.url).toMatch(/accounting-categories\/category%2F1$/);
    expect(calls[5]).toMatchObject({ method: 'PATCH', body: { name: 'Business travel' } });
    expect(calls[7]?.method).toBe('DELETE');
    expect(created.code).toBe('TRV');
    expect(listed).toHaveLength(2);
    expect(retrieved.providerCategoryId).toBe('category-1');
    expect(changed.name).toBe('Business travel');
  });

  it('rejects a category without Revolut required code before HTTP', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch();

    await expect(
      provider(fetch).createAccountingCategory({ name: 'Travel' }, context),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    expect(calls).toHaveLength(0);
  });

  it('creates, paginates, retrieves, renames, and deletes tax rates', async () => {
    const second = { ...accountingTaxRate, id: 'tax-2', percentage: 7.5 };
    const renamed = { ...accountingTaxRate, name: 'VAT standard' };
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: { id: 'tax-1' } },
      { body: accountingTaxRate },
      { body: { tax_rates: [accountingTaxRate], next_page_token: 'next-tax' } },
      { body: { tax_rates: [second] } },
      { body: accountingTaxRate },
      {},
      { body: renamed },
      {},
    );
    const instance = provider(fetch);

    const created = await instance.createAccountingTaxRate(
      { name: 'VAT 20', percentage: 20 },
      context,
    );
    const listed = await instance.listAccountingTaxRates({ limit: 2 });
    await instance.retrieveAccountingTaxRate('tax/1');
    const updated = await instance.updateAccountingTaxRate(
      { providerTaxRateId: 'tax-1', name: 'VAT standard' },
      context,
    );
    await instance.deleteAccountingTaxRate('tax-1', context);

    expect(calls[0]).toMatchObject({ method: 'POST', body: { name: 'VAT 20', percentage: 20 } });
    expect(new URL(calls[3]?.url ?? '').searchParams.get('page_token')).toBe('next-tax');
    expect(calls[4]?.url).toMatch(/tax-rates\/tax%2F1$/);
    expect(calls[5]).toMatchObject({ method: 'PATCH', body: { name: 'VAT standard' } });
    expect(calls[7]?.method).toBe('DELETE');
    expect(created.percentage).toBe(20);
    expect(listed).toHaveLength(2);
    expect(updated.name).toBe('VAT standard');
  });

  it('manages grouped labels with opaque compound provider IDs', async () => {
    const renamed = { ...accountingLabel, name: 'Platform' };
    const labelPage = (label = accountingLabel) => ({ labels: [label] });
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: { id: 'label-1' } },
      { body: labelPage() },
      { body: { label_groups: [accountingLabelGroup] } },
      { body: labelPage() },
      { body: labelPage() },
      {},
      { body: labelPage(renamed) },
      {},
    );
    const instance = provider(fetch);

    const created = await instance.createAccountingLabel(
      { name: 'Engineering', providerGroupId: 'group-1' },
      context,
    );
    const listed = await instance.listAccountingLabels({ limit: 1 });
    const retrieved = await instance.retrieveAccountingLabel('group-1:label-1');
    const updated = await instance.updateAccountingLabel(
      { providerLabelId: 'group-1:label-1', name: 'Platform' },
      context,
    );
    await instance.deleteAccountingLabel('group-1:label-1', context);

    expect(calls[0]).toMatchObject({
      url: 'https://b2b.revolut.com/api/1.0/label-groups/group-1/labels',
      method: 'POST',
      body: { name: 'Engineering' },
    });
    expect(calls[2]?.url).toContain('/label-groups?');
    expect(calls[5]).toMatchObject({ method: 'PATCH', body: { name: 'Platform' } });
    expect(calls[7]?.method).toBe('DELETE');
    expect(created.providerLabelId).toBe('group-1:label-1');
    expect(listed).toHaveLength(1);
    expect(retrieved.providerGroupId).toBe('group-1');
    expect(updated.name).toBe('Platform');
  });

  it('rejects labels without a group and normalizes external-management errors', async () => {
    const empty = fakeRevolutBusinessFetch();
    await expect(
      provider(empty.fetch).createAccountingLabel({ name: 'Engineering' }, context),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    expect(empty.calls).toHaveLength(0);

    const external = fakeRevolutBusinessFetch({
      status: 422,
      body: { code: 'validation_error', message: 'Externally managed resource' },
    });
    await expect(
      provider(external.fetch).deleteAccountingCategory('external', context),
    ).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'revolut-business-accounting' }),
    });
  });
});
