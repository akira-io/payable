import type {
  AccountingCapabilities,
  AccountingCategoryDTO,
  AccountingExpenseDTO,
  AccountingLabelDTO,
  AccountingLedgerEntryDTO,
  AccountingListInput,
  AccountingTaxRateDTO,
  CreateAccountingCategoryInput,
  CreateAccountingLabelInput,
  CreateAccountingTaxRateInput,
  ListAccountingExpensesInput,
  ListAccountingLedgerEntriesInput,
  UpdateAccountingCategoryInput,
  UpdateAccountingExpenseInput,
  UpdateAccountingLabelInput,
  UpdateAccountingTaxRateInput,
} from '../dtos/accounting.dto';
import type { OperationContext } from '../dtos/common.dto';

export interface AccountingProvider {
  readonly name: string;
  capabilities(): AccountingCapabilities;
}

export interface AccountingCategoryCapable {
  createAccountingCategory(
    input: CreateAccountingCategoryInput,
    ctx: OperationContext,
  ): Promise<AccountingCategoryDTO>;
  listAccountingCategories(input?: AccountingListInput): Promise<AccountingCategoryDTO[]>;
  retrieveAccountingCategory(providerCategoryId: string): Promise<AccountingCategoryDTO>;
  updateAccountingCategory(
    input: UpdateAccountingCategoryInput,
    ctx: OperationContext,
  ): Promise<AccountingCategoryDTO>;
  deleteAccountingCategory(providerCategoryId: string, ctx: OperationContext): Promise<void>;
}

export interface AccountingTaxRateCapable {
  createAccountingTaxRate(
    input: CreateAccountingTaxRateInput,
    ctx: OperationContext,
  ): Promise<AccountingTaxRateDTO>;
  listAccountingTaxRates(input?: AccountingListInput): Promise<AccountingTaxRateDTO[]>;
  retrieveAccountingTaxRate(providerTaxRateId: string): Promise<AccountingTaxRateDTO>;
  updateAccountingTaxRate(
    input: UpdateAccountingTaxRateInput,
    ctx: OperationContext,
  ): Promise<AccountingTaxRateDTO>;
  deleteAccountingTaxRate(providerTaxRateId: string, ctx: OperationContext): Promise<void>;
}

export interface AccountingLabelCapable {
  createAccountingLabel(
    input: CreateAccountingLabelInput,
    ctx: OperationContext,
  ): Promise<AccountingLabelDTO>;
  listAccountingLabels(input?: AccountingListInput): Promise<AccountingLabelDTO[]>;
  retrieveAccountingLabel(providerLabelId: string): Promise<AccountingLabelDTO>;
  updateAccountingLabel(
    input: UpdateAccountingLabelInput,
    ctx: OperationContext,
  ): Promise<AccountingLabelDTO>;
  deleteAccountingLabel(providerLabelId: string, ctx: OperationContext): Promise<void>;
}

export interface AccountingExpenseCapable {
  listAccountingExpenses(input?: ListAccountingExpensesInput): Promise<AccountingExpenseDTO[]>;
  retrieveAccountingExpense(providerExpenseId: string): Promise<AccountingExpenseDTO>;
  updateAccountingExpense(
    input: UpdateAccountingExpenseInput,
    ctx: OperationContext,
  ): Promise<AccountingExpenseDTO>;
}

export interface AccountingLedgerCapable {
  listAccountingLedgerEntries(
    input?: ListAccountingLedgerEntriesInput,
  ): Promise<AccountingLedgerEntryDTO[]>;
  retrieveAccountingLedgerEntry(providerEntryId: string): Promise<AccountingLedgerEntryDTO>;
}

export function isAccountingCategoryCapable(
  provider: AccountingProvider,
): provider is AccountingProvider & AccountingCategoryCapable {
  const candidate = provider as Partial<AccountingCategoryCapable>;
  return (
    typeof candidate.createAccountingCategory === 'function' &&
    typeof candidate.listAccountingCategories === 'function' &&
    typeof candidate.retrieveAccountingCategory === 'function' &&
    typeof candidate.updateAccountingCategory === 'function' &&
    typeof candidate.deleteAccountingCategory === 'function'
  );
}

export function isAccountingTaxRateCapable(
  provider: AccountingProvider,
): provider is AccountingProvider & AccountingTaxRateCapable {
  const candidate = provider as Partial<AccountingTaxRateCapable>;
  return (
    typeof candidate.createAccountingTaxRate === 'function' &&
    typeof candidate.listAccountingTaxRates === 'function' &&
    typeof candidate.retrieveAccountingTaxRate === 'function' &&
    typeof candidate.updateAccountingTaxRate === 'function' &&
    typeof candidate.deleteAccountingTaxRate === 'function'
  );
}

export function isAccountingLabelCapable(
  provider: AccountingProvider,
): provider is AccountingProvider & AccountingLabelCapable {
  const candidate = provider as Partial<AccountingLabelCapable>;
  return (
    typeof candidate.createAccountingLabel === 'function' &&
    typeof candidate.listAccountingLabels === 'function' &&
    typeof candidate.retrieveAccountingLabel === 'function' &&
    typeof candidate.updateAccountingLabel === 'function' &&
    typeof candidate.deleteAccountingLabel === 'function'
  );
}

export function isAccountingExpenseCapable(
  provider: AccountingProvider,
): provider is AccountingProvider & AccountingExpenseCapable {
  const candidate = provider as Partial<AccountingExpenseCapable>;
  return (
    typeof candidate.listAccountingExpenses === 'function' &&
    typeof candidate.retrieveAccountingExpense === 'function' &&
    typeof candidate.updateAccountingExpense === 'function'
  );
}

export function isAccountingLedgerCapable(
  provider: AccountingProvider,
): provider is AccountingProvider & AccountingLedgerCapable {
  const candidate = provider as Partial<AccountingLedgerCapable>;
  return (
    typeof candidate.listAccountingLedgerEntries === 'function' &&
    typeof candidate.retrieveAccountingLedgerEntry === 'function'
  );
}
