import { describe, expect, it } from 'vitest';
import { RevolutBusinessAccountingProvider } from '../src/infrastructure/providers/revolut/revolut-accounting-provider';
import { accountingExpense } from './support/revolut-accounting';
import { fakeRevolutBusinessFetch } from './support/revolut-business';

function provider(fetch: typeof globalThis.fetch) {
  return new RevolutBusinessAccountingProvider({
    tokenProvider: { getAccessToken: () => 'token-1' },
    fetch,
  });
}

describe('Revolut Business Accounting expense reads', () => {
  it('paginates expenses by expense date and maps only normalized fields', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      accountingExpense(
        `expense-${index + 1}`,
        'approved',
        new Date(Date.UTC(2026, 6, 14, 0, 0, 500 - index)).toISOString(),
      ),
    );
    const last = accountingExpense('expense-501', 'approved', '2026-07-13T00:00:00.000Z');
    const { fetch, calls } = fakeRevolutBusinessFetch(
      { body: firstPage },
      { body: [last] },
      { body: accountingExpense() },
    );
    const instance = provider(fetch);

    const expenses = await instance.listAccountingExpenses({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-15T00:00:00Z'),
      limit: 501,
    });
    const retrieved = await instance.retrieveAccountingExpense('expense/1');

    expect(new URL(calls[0]?.url ?? '').searchParams.get('count')).toBe('500');
    expect(new URL(calls[1]?.url ?? '').searchParams.get('count')).toBe('1');
    expect(new URL(calls[1]?.url ?? '').searchParams.get('to')).toBe(firstPage[499]?.expense_date);
    expect(calls[2]?.url).toBe('https://b2b.revolut.com/api/1.0/expenses/expense%2F1');
    expect(calls.every((call) => !call.url.includes('/receipts/'))).toBe(true);
    expect(expenses).toHaveLength(501);
    expect(retrieved).toMatchObject({
      providerExpenseId: 'expense-1',
      providerTransactionId: 'transaction-expense-1',
      merchantName: 'Cafe Example',
      providerCategoryId: 'category-1',
      providerTaxRateId: 'tax-1',
      status: 'completed',
    });
    expect(retrieved.amount.amount()).toBe(2550);
    expect(JSON.stringify(retrieved)).not.toContain('Private employee name');
    expect(JSON.stringify(retrieved)).not.toContain('receipt-private-1');
  });

  it.each([
    ['missing_info', 'pending'],
    ['awaiting_review', 'pending'],
    ['pending_reimbursement', 'pending'],
    ['approved', 'completed'],
    ['refunded', 'completed'],
    ['reverted', 'completed'],
    ['rejected', 'rejected'],
    ['refund_requested', 'rejected'],
    ['future_state', 'unknown'],
  ] as const)('maps expense state %s to %s', async (state, expected) => {
    const { fetch } = fakeRevolutBusinessFetch({ body: accountingExpense('expense-1', state) });

    const expense = await provider(fetch).retrieveAccountingExpense('expense-1');

    expect(expense.status).toBe(expected);
  });

  it('filters normalized expense states without sending incompatible provider filters', async () => {
    const { fetch, calls } = fakeRevolutBusinessFetch({
      body: [
        accountingExpense('expense-1', 'approved'),
        accountingExpense('expense-2', 'awaiting_review'),
        accountingExpense('expense-3', 'refund_requested'),
      ],
    });

    const expenses = await provider(fetch).listAccountingExpenses({
      status: 'rejected',
      limit: 10,
    });

    expect(expenses.map((expense) => expense.providerExpenseId)).toEqual(['expense-3']);
    expect(new URL(calls[0]?.url ?? '').searchParams.has('state')).toBe(false);
  });

  it('does not collapse different split categories or tax rates', async () => {
    const expense = accountingExpense();
    expense.splits.push({
      amount: { amount: 10, currency: 'EUR' },
      category: { id: 'category-2', name: 'Travel', code: 'TRV' },
      tax_rate: { id: 'tax-2', name: 'VAT 7', percentage: 7 },
    });
    const { fetch } = fakeRevolutBusinessFetch({ body: expense });

    const result = await provider(fetch).retrieveAccountingExpense('expense-1');

    expect(result.providerCategoryId).toBeNull();
    expect(result.providerTaxRateId).toBeNull();
  });
});
