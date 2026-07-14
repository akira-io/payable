import type {
  AccountingExpenseDTO,
  ListAccountingExpensesInput,
} from '../../../domain/dtos/accounting.dto';
import { mapRevolutAccountingExpense } from './revolut-accounting-mappers';
import {
  REVOLUT_ACCOUNTING_DEFAULT_LIMIT,
  REVOLUT_ACCOUNTING_PAGE_SIZE,
} from './revolut-accounting-pagination';
import type { RevolutAccountingExpense, RevolutBusinessRequest } from './revolut-business-types';

export class RevolutAccountingExpenses {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async list(input: ListAccountingExpensesInput = {}): Promise<AccountingExpenseDTO[]> {
    const limit = Math.max(0, input.limit ?? REVOLUT_ACCOUNTING_DEFAULT_LIMIT);
    const expenses: AccountingExpenseDTO[] = [];
    let to = input.to?.toISOString();
    while (expenses.length < limit) {
      const remaining = limit - expenses.length;
      const count = Math.min(remaining, REVOLUT_ACCOUNTING_PAGE_SIZE);
      const query = expenseQuery(input, count, to);
      const page = await this.request<RevolutAccountingExpense[]>(`/expenses?${query}`, {
        method: 'GET',
      });
      const mapped = page.map(mapRevolutAccountingExpense);
      expenses.push(
        ...mapped
          .filter((expense) => !input.status || expense.status === input.status)
          .slice(0, remaining),
      );
      const nextTo = page.at(-1)?.expense_date;
      if (page.length < count || !nextTo || nextTo === to) {
        break;
      }
      to = nextTo;
    }
    return expenses;
  }

  async retrieve(providerExpenseId: string): Promise<AccountingExpenseDTO> {
    const expense = await this.request<RevolutAccountingExpense>(
      `/expenses/${encodeURIComponent(providerExpenseId)}`,
      { method: 'GET' },
    );
    return mapRevolutAccountingExpense(expense);
  }
}

function expenseQuery(input: ListAccountingExpensesInput, count: number, to?: string): string {
  const query = new URLSearchParams({ count: String(count) });
  if (input.from) {
    query.set('from', input.from.toISOString());
  }
  if (to) {
    query.set('to', to);
  }
  return query.toString();
}
