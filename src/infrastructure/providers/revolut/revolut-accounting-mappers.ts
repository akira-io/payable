import type {
  AccountingCategoryDTO,
  AccountingExpenseDTO,
  AccountingLabelDTO,
  AccountingTaxRateDTO,
} from '../../../domain/dtos/accounting.dto';
import { revolutBusinessMoney } from './revolut-business-amounts';
import type {
  RevolutAccountingCategory,
  RevolutAccountingExpense,
  RevolutAccountingExpenseSplit,
  RevolutAccountingLabel,
  RevolutAccountingTaxRate,
} from './revolut-business-types';

export function mapRevolutAccountingCategory(
  category: RevolutAccountingCategory,
): AccountingCategoryDTO {
  return {
    providerCategoryId: category.id,
    name: category.name,
    code: category.code ?? null,
    providerDefaultTaxRateId: category.default_tax_rate_id ?? null,
    createdAt: date(category.created_at),
    updatedAt: date(category.updated_at),
  };
}

export function mapRevolutAccountingTaxRate(
  taxRate: RevolutAccountingTaxRate,
): AccountingTaxRateDTO {
  return {
    providerTaxRateId: taxRate.id,
    name: taxRate.name,
    percentage: taxRate.percentage,
    createdAt: date(taxRate.created_at),
    updatedAt: date(taxRate.updated_at),
  };
}

export function mapRevolutAccountingLabel(
  label: RevolutAccountingLabel,
  groupId: string,
): AccountingLabelDTO {
  return {
    providerLabelId: `${groupId}:${label.id}`,
    providerGroupId: groupId,
    name: label.name,
  };
}

export function mapRevolutAccountingExpense(
  expense: RevolutAccountingExpense,
): AccountingExpenseDTO {
  return {
    providerExpenseId: expense.id,
    providerTransactionId: expense.transaction_id ?? null,
    amount: revolutBusinessMoney(expense.spent_amount.amount, expense.spent_amount.currency),
    merchantName: expense.merchant ?? null,
    providerCategoryId: commonSplitId(expense.splits, (split) => split.category?.id),
    providerTaxRateId: commonSplitId(expense.splits, (split) => split.tax_rate?.id),
    status: expenseStatus(expense.state),
    spentAt: date(expense.expense_date),
    updatedAt: date(expense.completed_at ?? expense.submitted_at),
  };
}

function commonSplitId(
  splits: RevolutAccountingExpenseSplit[],
  select: (split: RevolutAccountingExpenseSplit) => string | undefined,
): string | null {
  const ids = new Set(splits.map(select).filter((id): id is string => Boolean(id)));
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
}

function expenseStatus(state: string): AccountingExpenseDTO['status'] {
  if (
    state === 'missing_info' ||
    state === 'awaiting_review' ||
    state === 'pending_reimbursement'
  ) {
    return 'pending';
  }
  if (state === 'approved' || state === 'refunded' || state === 'reverted') {
    return 'completed';
  }
  if (state === 'rejected' || state === 'refund_requested') {
    return 'rejected';
  }
  return 'unknown';
}

function date(value?: string): Date | null {
  return value ? new Date(value) : null;
}
