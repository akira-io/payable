import type { Money } from '../value-objects/money';

export type TreasuryCapability =
  | 'accounts'
  | 'transactions'
  | 'transfers'
  | 'counterparties'
  | 'exchange';
export type TreasuryCapabilityValue = TreasuryCapability | (string & {});
export type TreasuryCapabilities = ReadonlySet<TreasuryCapabilityValue>;

export type TreasuryAccountStatus = 'open' | 'closed' | 'inactive' | 'unknown';

export interface TreasuryBalanceDTO {
  current: Money;
  available: Money | null;
  inboundPending: Money | null;
  outboundPending: Money | null;
}

export interface TreasuryAccountDTO {
  providerAccountId: string;
  name: string | null;
  status: TreasuryAccountStatus;
  country: string | null;
  balances: TreasuryBalanceDTO[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ListTreasuryAccountsInput {
  limit?: number;
}

export type TreasuryTransactionStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'reversed'
  | 'unknown';

export interface TreasuryTransactionLegDTO {
  providerAccountId: string;
  providerCounterpartyId: string | null;
  amount: Money;
  fee: Money | null;
  balance: Money | null;
  description: string | null;
}

export interface TreasuryTransactionDTO {
  providerTransactionId: string;
  type: string;
  status: TreasuryTransactionStatus;
  reference: string | null;
  legs: TreasuryTransactionLegDTO[];
  createdAt: Date | null;
  completedAt: Date | null;
}

export interface ListTreasuryTransactionsInput {
  providerAccountId: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export type TreasuryTransferDestination =
  | { type: 'account'; providerAccountId: string }
  | { type: 'payment_method'; providerPaymentMethodId: string }
  | {
      type: 'counterparty';
      providerCounterpartyId: string;
      providerAccountId?: string;
    };

export interface CreateTreasuryTransferInput {
  sourceProviderAccountId: string;
  destination: TreasuryTransferDestination;
  amount: Money;
  reference?: string;
}

export interface ListTreasuryTransfersInput {
  providerAccountId: string;
  limit?: number;
}

export interface TreasuryTransferDTO {
  providerTransferId: string;
  sourceProviderAccountId: string;
  destination: TreasuryTransferDestination;
  amount: Money;
  status: TreasuryTransactionStatus;
  reference: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
}

export interface TreasuryCounterpartyAccountDTO {
  providerAccountId: string;
  name: string | null;
  currency: string | null;
  country: string | null;
  type: string;
}

export interface TreasuryCounterpartyDTO {
  providerCounterpartyId: string;
  name: string;
  status: string;
  accounts: TreasuryCounterpartyAccountDTO[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ListTreasuryCounterpartiesInput {
  limit?: number;
}

export interface TreasuryExchangeQuoteInput {
  sourceAmount: Money;
  targetCurrency: string;
}

export interface TreasuryExchangeQuoteDTO {
  sourceAmount: Money;
  targetAmount: Money;
  rate: number;
  fee: Money | null;
  quotedAt: Date | null;
}

interface CreateTreasuryExchangeBase {
  sourceProviderAccountId: string;
  targetProviderAccountId: string;
  sourceCurrency: string;
  targetCurrency: string;
  reference?: string;
}

export type CreateTreasuryExchangeInput = CreateTreasuryExchangeBase &
  ({ sourceAmount: Money; targetAmount?: never } | { sourceAmount?: never; targetAmount: Money });

export interface TreasuryExchangeDTO {
  providerTransactionId: string;
  status: TreasuryTransactionStatus;
  createdAt: Date | null;
  completedAt: Date | null;
}
