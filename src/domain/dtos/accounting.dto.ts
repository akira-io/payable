import type { Money } from '../value-objects/money';

export type AccountingCapability =
  | 'categories'
  | 'taxRates'
  | 'labels'
  | 'expenseReads'
  | 'expenses'
  | 'ledger';
export type AccountingCapabilityValue = AccountingCapability | (string & {});
export type AccountingCapabilities = ReadonlySet<AccountingCapabilityValue>;

export interface AccountingCategoryDTO {
  providerCategoryId: string;
  name: string;
  code: string | null;
  providerDefaultTaxRateId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AccountingTaxRateDTO {
  providerTaxRateId: string;
  name: string;
  percentage: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AccountingLabelDTO {
  providerLabelId: string;
  providerGroupId: string | null;
  name: string;
}

export interface AccountingExpenseDTO {
  providerExpenseId: string;
  providerTransactionId: string | null;
  amount: Money;
  merchantName: string | null;
  providerCategoryId: string | null;
  providerTaxRateId: string | null;
  status: 'pending' | 'completed' | 'rejected' | 'unknown';
  spentAt: Date | null;
  updatedAt: Date | null;
}

export interface AccountingLedgerEntryDTO {
  providerEntryId: string;
  reference: string | null;
  debit: Money | null;
  credit: Money | null;
  occurredAt: Date | null;
}

export interface AccountingListInput {
  limit?: number;
}

export interface CreateAccountingCategoryInput {
  name: string;
  code?: string;
  providerDefaultTaxRateId?: string;
}

export interface UpdateAccountingCategoryInput {
  providerCategoryId: string;
  name?: string;
  code?: string;
  providerDefaultTaxRateId?: string;
}

export interface CreateAccountingTaxRateInput {
  name: string;
  percentage: number;
}

export interface UpdateAccountingTaxRateInput {
  providerTaxRateId: string;
  name: string;
}

export interface CreateAccountingLabelInput {
  name: string;
  providerGroupId?: string;
}

export interface UpdateAccountingLabelInput extends CreateAccountingLabelInput {
  providerLabelId: string;
}

export interface ListAccountingExpensesInput extends AccountingListInput {
  from?: Date;
  to?: Date;
  status?: AccountingExpenseDTO['status'];
}

export interface UpdateAccountingExpenseInput {
  providerExpenseId: string;
  providerCategoryId?: string;
  providerTaxRateId?: string;
  providerLabelIds?: string[];
}

export interface ListAccountingLedgerEntriesInput extends AccountingListInput {
  from?: Date;
  to?: Date;
  accountReference?: string;
}
