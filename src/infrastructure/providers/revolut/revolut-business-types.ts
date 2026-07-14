import type { RevolutEnvironment, RevolutFetch } from './revolut-types';

export type RevolutBusinessEnvironment = RevolutEnvironment;
export type RevolutBusinessFetch = RevolutFetch;

export interface RevolutBusinessRequestOptions {
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
  body?: unknown;
}

export type RevolutBusinessRequest = <T>(
  path: string,
  options: RevolutBusinessRequestOptions,
) => Promise<T>;

export interface RevolutBusinessAccount {
  id: string;
  name?: string;
  balance: number;
  currency: string;
  state: string;
  created_at?: string;
  updated_at?: string;
}

export interface RevolutBusinessTransactionLeg {
  leg_id: string;
  account_id: string;
  amount: number;
  fee?: number;
  currency: string;
  description?: string;
  balance?: number;
  counterparty?: {
    id?: string;
    account_id?: string;
    account_type: string;
  };
}

export interface RevolutBusinessTransaction {
  id: string;
  type: string;
  state: string;
  request_id?: string;
  reference?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  card?: {
    id?: string;
    card_id?: string;
  };
  legs: RevolutBusinessTransactionLeg[];
}

export interface RevolutBusinessCard {
  id: string;
  holder_id?: string;
  created_at?: string;
  updated_at?: string;
  virtual: boolean;
  last_digits: string;
  expiry: string;
  label?: string;
  state: string;
  product?: {
    brand?: string;
    name?: string;
    scheme?: string;
  };
  accounts?: string[];
}

export interface RevolutBusinessCounterparty {
  id: string;
  name: string;
  state: string;
  created_at?: string;
  updated_at?: string;
  accounts?: RevolutBusinessCounterpartyAccount[];
}

export interface RevolutBusinessCounterpartyAccount {
  id: string;
  name?: string;
  bank_country?: string;
  currency: string;
  type: string;
}

export interface RevolutBusinessTransferResponse {
  id: string;
  state: string;
  created_at?: string;
  completed_at?: string;
}

export interface RevolutBusinessExchangeQuote {
  from: { amount: number; currency: string };
  to: { amount: number; currency: string };
  rate: number;
  fee?: { amount: number; currency: string };
  rate_date?: string;
}

export interface RevolutBusinessExchangeResponse {
  id: string;
  state: string;
  created_at?: string;
  completed_at?: string;
}

export interface RevolutBusinessWebhookPayload {
  event: string;
  timestamp?: string;
  data: Record<string, unknown>;
}

export interface RevolutBusinessCreatedResource {
  id: string;
}

export interface RevolutAccountingCategory {
  id: string;
  name: string;
  code?: string;
  default_tax_rate_id?: string;
  created_at: string;
  updated_at: string;
}

export interface RevolutAccountingCategories {
  accounting_categories: RevolutAccountingCategory[];
  next_page_token?: string;
}

export interface RevolutAccountingTaxRate {
  id: string;
  name: string;
  percentage: number;
  created_at: string;
  updated_at: string;
}

export interface RevolutAccountingTaxRates {
  tax_rates: RevolutAccountingTaxRate[];
  next_page_token?: string;
}

export interface RevolutAccountingLabelGroup {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface RevolutAccountingLabelGroups {
  label_groups: RevolutAccountingLabelGroup[];
  next_page_token?: string;
}

export interface RevolutAccountingLabel {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface RevolutAccountingLabels {
  labels: RevolutAccountingLabel[];
  next_page_token?: string;
}

export interface RevolutAccountingExpenseSplit {
  amount: { amount: number; currency: string };
  category?: { id: string; name: string; code?: string };
  tax_rate?: { id: string; name: string; percentage: number };
}

export interface RevolutAccountingExpense {
  id: string;
  state: string;
  transaction_type: string;
  description?: string;
  submitted_at?: string;
  completed_at?: string;
  payer?: string;
  merchant?: string;
  transaction_id?: string;
  expense_date: string;
  labels: Record<string, string[]>;
  splits: RevolutAccountingExpenseSplit[];
  receipt_ids: string[];
  spent_amount: { amount: number; currency: string };
}
