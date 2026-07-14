import type {
  AccountingCategoryCapable,
  AccountingExpenseReadCapable,
  AccountingLabelCapable,
  AccountingProvider,
  AccountingTaxRateCapable,
} from '../../../domain/contracts/accounting-provider.contract';
import type {
  AccountingCapabilities,
  AccountingCategoryDTO,
  AccountingExpenseDTO,
  AccountingLabelDTO,
  AccountingListInput,
  AccountingTaxRateDTO,
  CreateAccountingCategoryInput,
  CreateAccountingLabelInput,
  CreateAccountingTaxRateInput,
  ListAccountingExpensesInput,
  UpdateAccountingCategoryInput,
  UpdateAccountingLabelInput,
  UpdateAccountingTaxRateInput,
} from '../../../domain/dtos/accounting.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { RevolutAccountingCategories } from './revolut-accounting-categories';
import { RevolutAccountingExpenses } from './revolut-accounting-expenses';
import { RevolutAccountingLabels } from './revolut-accounting-labels';
import { RevolutAccountingTaxRates } from './revolut-accounting-tax-rates';
import {
  RevolutBusinessClient,
  type RevolutBusinessClientOptions,
  type RevolutBusinessTokenProvider,
} from './revolut-business-client';
import type { RevolutBusinessEnvironment, RevolutBusinessFetch } from './revolut-business-types';

export interface RevolutBusinessAccountingProviderOptions {
  tokenProvider: RevolutBusinessTokenProvider;
  environment?: RevolutBusinessEnvironment;
  baseUrl?: string;
  fetch?: RevolutBusinessFetch;
}

export class RevolutBusinessAccountingProvider
  implements
    AccountingProvider,
    AccountingCategoryCapable,
    AccountingTaxRateCapable,
    AccountingLabelCapable,
    AccountingExpenseReadCapable
{
  readonly name = 'revolut-business-accounting';
  private readonly categories: RevolutAccountingCategories;
  private readonly taxRates: RevolutAccountingTaxRates;
  private readonly labels: RevolutAccountingLabels;
  private readonly expenses: RevolutAccountingExpenses;

  constructor(options: RevolutBusinessAccountingProviderOptions) {
    const client = new RevolutBusinessClient({
      ...options,
      providerName: this.name,
    } satisfies RevolutBusinessClientOptions);
    const request = client.request.bind(client);
    this.categories = new RevolutAccountingCategories(request);
    this.taxRates = new RevolutAccountingTaxRates(request);
    this.labels = new RevolutAccountingLabels(request);
    this.expenses = new RevolutAccountingExpenses(request);
  }

  capabilities(): AccountingCapabilities {
    return new Set(['categories', 'taxRates', 'labels', 'expenseReads']);
  }

  createAccountingCategory(
    input: CreateAccountingCategoryInput,
    ctx: OperationContext,
  ): Promise<AccountingCategoryDTO> {
    return this.categories.create(input, ctx);
  }

  listAccountingCategories(input?: AccountingListInput): Promise<AccountingCategoryDTO[]> {
    return this.categories.list(input);
  }

  retrieveAccountingCategory(providerCategoryId: string): Promise<AccountingCategoryDTO> {
    return this.categories.retrieve(providerCategoryId);
  }

  updateAccountingCategory(
    input: UpdateAccountingCategoryInput,
    ctx: OperationContext,
  ): Promise<AccountingCategoryDTO> {
    return this.categories.update(input, ctx);
  }

  deleteAccountingCategory(providerCategoryId: string, ctx: OperationContext): Promise<void> {
    return this.categories.delete(providerCategoryId, ctx);
  }

  createAccountingTaxRate(
    input: CreateAccountingTaxRateInput,
    ctx: OperationContext,
  ): Promise<AccountingTaxRateDTO> {
    return this.taxRates.create(input, ctx);
  }

  listAccountingTaxRates(input?: AccountingListInput): Promise<AccountingTaxRateDTO[]> {
    return this.taxRates.list(input);
  }

  retrieveAccountingTaxRate(providerTaxRateId: string): Promise<AccountingTaxRateDTO> {
    return this.taxRates.retrieve(providerTaxRateId);
  }

  updateAccountingTaxRate(
    input: UpdateAccountingTaxRateInput,
    ctx: OperationContext,
  ): Promise<AccountingTaxRateDTO> {
    return this.taxRates.update(input, ctx);
  }

  deleteAccountingTaxRate(providerTaxRateId: string, ctx: OperationContext): Promise<void> {
    return this.taxRates.delete(providerTaxRateId, ctx);
  }

  createAccountingLabel(
    input: CreateAccountingLabelInput,
    ctx: OperationContext,
  ): Promise<AccountingLabelDTO> {
    return this.labels.create(input, ctx);
  }

  listAccountingLabels(input?: AccountingListInput): Promise<AccountingLabelDTO[]> {
    return this.labels.list(input);
  }

  retrieveAccountingLabel(providerLabelId: string): Promise<AccountingLabelDTO> {
    return this.labels.retrieve(providerLabelId);
  }

  updateAccountingLabel(
    input: UpdateAccountingLabelInput,
    ctx: OperationContext,
  ): Promise<AccountingLabelDTO> {
    return this.labels.update(input, ctx);
  }

  deleteAccountingLabel(providerLabelId: string, ctx: OperationContext): Promise<void> {
    return this.labels.delete(providerLabelId, ctx);
  }

  listAccountingExpenses(input?: ListAccountingExpensesInput): Promise<AccountingExpenseDTO[]> {
    return this.expenses.list(input);
  }

  retrieveAccountingExpense(providerExpenseId: string): Promise<AccountingExpenseDTO> {
    return this.expenses.retrieve(providerExpenseId);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `RevolutBusinessAccountingProvider { name: '${this.name}' }`;
  }
}
