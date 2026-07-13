import type { RevolutEnvironment, RevolutFetch } from './revolut-types';

export type RevolutBusinessEnvironment = RevolutEnvironment;
export type RevolutBusinessFetch = RevolutFetch;

export interface RevolutBusinessRequestOptions {
  method: 'GET' | 'POST';
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
  legs: RevolutBusinessTransactionLeg[];
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
