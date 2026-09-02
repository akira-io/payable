import type { Logger } from '../../../domain/contracts/logger.contract';

export const TRUST_MY_TRAVEL_ENVIRONMENTS = ['test', 'live'] as const;

export const TRUST_MY_TRAVEL_ACCOUNT_MODES = [
  'test',
  'draft',
  'live',
  'closed',
  'affiliate',
] as const;

export const TRUST_MY_TRAVEL_ACCOUNT_TYPES = ['protected-processing', 'trust'] as const;

export const TRUST_MY_TRAVEL_PROTECTION_TYPES = ['trust-my-travel', 'tmu-management'] as const;

export const TRUST_MY_TRAVEL_STATEMENT_PERIODS = ['biweek', 'week', 'month'] as const;

export const TRUST_MY_TRAVEL_TRANSACTION_TYPES = [
  'purchase',
  'authorize',
  'capture',
  'void',
  'refund',
  'vault',
  'retained_purchase',
  'chargeback',
] as const;

export const TRUST_MY_TRAVEL_PAYMENT_METHODS = ['bank-transfer', 'credit-card'] as const;

export const TRUST_MY_TRAVEL_ALLOCATION_OPERATORS = ['percent', 'flat'] as const;

export const TRUST_MY_TRAVEL_LANGUAGES = [
  'deDE',
  'enGB',
  'esES',
  'frFR',
  'itIT',
  'jaJA',
  'kkKK',
  'koKO',
  'lvLV',
  'ptBR',
  'roRO',
  'ruRU',
  'ukUK',
  'uzUZ',
  'zhZH',
] as const;

export type TrustMyTravelEnvironment = (typeof TRUST_MY_TRAVEL_ENVIRONMENTS)[number];

export const TRUST_MY_TRAVEL_ENVIRONMENT_BY_ACCOUNT_MODE: Readonly<
  Record<string, TrustMyTravelEnvironment | undefined>
> = {
  test: 'test',
  live: 'live',
};

export type TrustMyTravelAccountMode = (typeof TRUST_MY_TRAVEL_ACCOUNT_MODES)[number];
export type TrustMyTravelAccountType = (typeof TRUST_MY_TRAVEL_ACCOUNT_TYPES)[number];
export type TrustMyTravelProtectionType = (typeof TRUST_MY_TRAVEL_PROTECTION_TYPES)[number];
export type TrustMyTravelStatementPeriod = (typeof TRUST_MY_TRAVEL_STATEMENT_PERIODS)[number];
export type TrustMyTravelTransactionType = (typeof TRUST_MY_TRAVEL_TRANSACTION_TYPES)[number];
export type TrustMyTravelPaymentMethod = (typeof TRUST_MY_TRAVEL_PAYMENT_METHODS)[number];
export type TrustMyTravelAllocationOperator = (typeof TRUST_MY_TRAVEL_ALLOCATION_OPERATORS)[number];
export type TrustMyTravelLanguage = (typeof TRUST_MY_TRAVEL_LANGUAGES)[number];

export interface TrustMyTravelChannelResponse {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  account_type: string;
  account_mode: string;
  protection_type: string;
  currencies: string;
  language: string;
  channel_status: string;
  statement_period: string;
  cardholder_present: boolean;
  server_to_server: boolean;
}

export interface TrustMyTravelProviderOptions {
  path: string;
  apiToken: string;
  channelId: number;
  channelSecret: string;
  environment: TrustMyTravelEnvironment;
  modalVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  logger?: Logger;
  directCharge?: { psp: string };
}
