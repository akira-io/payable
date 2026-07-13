import type {
  CreateTreasuryTransferInput,
  TreasuryAccountDTO,
  TreasuryAccountStatus,
  TreasuryCounterpartyDTO,
  TreasuryExchangeDTO,
  TreasuryExchangeQuoteDTO,
  TreasuryTransactionDTO,
  TreasuryTransactionStatus,
  TreasuryTransferDestination,
  TreasuryTransferDTO,
} from '../../../domain/dtos/treasury.dto';
import { revolutBusinessMoney } from './revolut-business-amounts';
import type {
  RevolutBusinessAccount,
  RevolutBusinessCounterparty,
  RevolutBusinessExchangeQuote,
  RevolutBusinessExchangeResponse,
  RevolutBusinessTransaction,
  RevolutBusinessTransactionLeg,
  RevolutBusinessTransferResponse,
} from './revolut-business-types';

const ACCOUNT_STATUS: Record<string, TreasuryAccountStatus> = {
  active: 'open',
  inactive: 'inactive',
};

const TRANSACTION_STATUS: Record<string, TreasuryTransactionStatus> = {
  created: 'pending',
  pending: 'pending',
  completed: 'completed',
  declined: 'failed',
  failed: 'failed',
  reverted: 'reversed',
};

export function toRevolutBusinessAccountDTO(account: RevolutBusinessAccount): TreasuryAccountDTO {
  return {
    providerAccountId: account.id,
    name: account.name ?? null,
    status: ACCOUNT_STATUS[account.state] ?? 'unknown',
    country: null,
    balances: [
      {
        current: revolutBusinessMoney(account.balance, account.currency),
        available: null,
        inboundPending: null,
        outboundPending: null,
      },
    ],
    createdAt: date(account.created_at),
    updatedAt: date(account.updated_at),
  };
}

export function toRevolutBusinessTransactionDTO(
  transaction: RevolutBusinessTransaction,
): TreasuryTransactionDTO {
  return {
    providerTransactionId: transaction.id,
    type: transaction.type,
    status: transactionStatus(transaction.state),
    reference: transaction.reference ?? transaction.request_id ?? null,
    legs: transaction.legs.map((leg) => ({
      providerAccountId: leg.account_id,
      providerCounterpartyId: leg.counterparty?.id ?? null,
      amount: revolutBusinessMoney(leg.amount, leg.currency),
      fee: leg.fee === undefined ? null : revolutBusinessMoney(leg.fee, leg.currency),
      balance: leg.balance === undefined ? null : revolutBusinessMoney(leg.balance, leg.currency),
      description: leg.description ?? null,
    })),
    createdAt: date(transaction.created_at),
    completedAt: date(transaction.completed_at),
  };
}

export function toRevolutBusinessCounterpartyDTO(
  counterparty: RevolutBusinessCounterparty,
): TreasuryCounterpartyDTO {
  return {
    providerCounterpartyId: counterparty.id,
    name: counterparty.name,
    status: counterparty.state,
    accounts: (counterparty.accounts ?? []).map((account) => ({
      providerAccountId: account.id,
      name: account.name ?? null,
      currency: account.currency ?? null,
      country: account.bank_country ?? null,
      type: account.type,
    })),
    createdAt: date(counterparty.created_at),
    updatedAt: date(counterparty.updated_at),
  };
}

export function toCreatedRevolutBusinessTransferDTO(
  response: RevolutBusinessTransferResponse,
  input: CreateTreasuryTransferInput,
): TreasuryTransferDTO {
  return {
    providerTransferId: response.id,
    sourceProviderAccountId: input.sourceProviderAccountId,
    destination: input.destination,
    amount: input.amount,
    status: transactionStatus(response.state),
    reference: input.reference ?? null,
    createdAt: date(response.created_at),
    completedAt: date(response.completed_at),
  };
}

export function toRevolutBusinessTransferDTO(
  transaction: RevolutBusinessTransaction,
): TreasuryTransferDTO {
  const source = sourceLeg(transaction.legs);
  const amount = revolutBusinessMoney(Math.abs(source.amount), source.currency);
  return {
    providerTransferId: transaction.id,
    sourceProviderAccountId: source.account_id,
    destination: transferDestination(transaction.legs, source),
    amount,
    status: transactionStatus(transaction.state),
    reference: transaction.reference ?? transaction.request_id ?? null,
    createdAt: date(transaction.created_at),
    completedAt: date(transaction.completed_at),
  };
}

export function toRevolutBusinessExchangeQuoteDTO(
  quote: RevolutBusinessExchangeQuote,
): TreasuryExchangeQuoteDTO {
  return {
    sourceAmount: revolutBusinessMoney(quote.from.amount, quote.from.currency),
    targetAmount: revolutBusinessMoney(quote.to.amount, quote.to.currency),
    rate: quote.rate,
    fee: quote.fee ? revolutBusinessMoney(quote.fee.amount, quote.fee.currency) : null,
    quotedAt: date(quote.rate_date),
  };
}

export function toRevolutBusinessExchangeDTO(
  exchange: RevolutBusinessExchangeResponse,
): TreasuryExchangeDTO {
  return {
    providerTransactionId: exchange.id,
    status: transactionStatus(exchange.state),
    createdAt: date(exchange.created_at),
    completedAt: date(exchange.completed_at),
  };
}

function sourceLeg(legs: RevolutBusinessTransactionLeg[]): RevolutBusinessTransactionLeg {
  const source = legs.find((leg) => leg.amount < 0) ?? legs[0];
  if (!source) {
    throw new TypeError('Revolut Business transfer transaction has no legs');
  }
  return source;
}

function transferDestination(
  legs: RevolutBusinessTransactionLeg[],
  source: RevolutBusinessTransactionLeg,
): TreasuryTransferDestination | null {
  if (source.counterparty?.id) {
    return {
      type: 'counterparty',
      providerCounterpartyId: source.counterparty.id,
      providerAccountId: source.counterparty.account_id,
    };
  }
  const target = legs.find((leg) => leg.account_id !== source.account_id && leg.amount > 0);
  return target ? { type: 'account', providerAccountId: target.account_id } : null;
}

function transactionStatus(status: string): TreasuryTransactionStatus {
  return TRANSACTION_STATUS[status] ?? 'unknown';
}

function date(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}
