import type { OperationContext } from '../dtos/common.dto';
import type {
  CreateTreasuryExchangeInput,
  CreateTreasuryTransferInput,
  ListTreasuryAccountsInput,
  ListTreasuryCounterpartiesInput,
  ListTreasuryTransactionsInput,
  ListTreasuryTransfersInput,
  TreasuryAccountDTO,
  TreasuryCapabilities,
  TreasuryCounterpartyDTO,
  TreasuryExchangeDTO,
  TreasuryExchangeQuoteDTO,
  TreasuryExchangeQuoteInput,
  TreasuryTransactionDTO,
  TreasuryTransferDTO,
} from '../dtos/treasury.dto';
import type { VerifiedTreasuryWebhook } from '../dtos/treasury-webhook.dto';
import type { WebhookVerificationInput } from '../dtos/webhook.dto';

export interface TreasuryProvider {
  readonly name: string;
  capabilities(): TreasuryCapabilities;
}

export interface TreasuryAccountCapable {
  listTreasuryAccounts(input?: ListTreasuryAccountsInput): Promise<TreasuryAccountDTO[]>;
  retrieveTreasuryAccount(providerAccountId: string): Promise<TreasuryAccountDTO>;
}

export interface TreasuryTransactionCapable {
  listTreasuryTransactions(input: ListTreasuryTransactionsInput): Promise<TreasuryTransactionDTO[]>;
  retrieveTreasuryTransaction(providerTransactionId: string): Promise<TreasuryTransactionDTO>;
}

export interface TreasuryTransferCapable {
  createTreasuryTransfer(
    input: CreateTreasuryTransferInput,
    ctx: OperationContext,
  ): Promise<TreasuryTransferDTO>;
  listTreasuryTransfers(input: ListTreasuryTransfersInput): Promise<TreasuryTransferDTO[]>;
  retrieveTreasuryTransfer(providerTransferId: string): Promise<TreasuryTransferDTO>;
}

export interface TreasuryCounterpartyCapable {
  listTreasuryCounterparties(
    input?: ListTreasuryCounterpartiesInput,
  ): Promise<TreasuryCounterpartyDTO[]>;
  retrieveTreasuryCounterparty(providerCounterpartyId: string): Promise<TreasuryCounterpartyDTO>;
}

export interface TreasuryExchangeCapable {
  quoteTreasuryExchange(input: TreasuryExchangeQuoteInput): Promise<TreasuryExchangeQuoteDTO>;
  createTreasuryExchange(
    input: CreateTreasuryExchangeInput,
    ctx: OperationContext,
  ): Promise<TreasuryExchangeDTO>;
}

export interface TreasuryWebhookCapable {
  verifyTreasuryWebhook(input: WebhookVerificationInput): Promise<VerifiedTreasuryWebhook>;
}

export function isTreasuryAccountCapable(
  provider: TreasuryProvider,
): provider is TreasuryProvider & TreasuryAccountCapable {
  const candidate = provider as Partial<TreasuryAccountCapable>;
  return (
    typeof candidate.listTreasuryAccounts === 'function' &&
    typeof candidate.retrieveTreasuryAccount === 'function'
  );
}

export function isTreasuryTransactionCapable(
  provider: TreasuryProvider,
): provider is TreasuryProvider & TreasuryTransactionCapable {
  const candidate = provider as Partial<TreasuryTransactionCapable>;
  return (
    typeof candidate.listTreasuryTransactions === 'function' &&
    typeof candidate.retrieveTreasuryTransaction === 'function'
  );
}

export function isTreasuryTransferCapable(
  provider: TreasuryProvider,
): provider is TreasuryProvider & TreasuryTransferCapable {
  const candidate = provider as Partial<TreasuryTransferCapable>;
  return (
    typeof candidate.createTreasuryTransfer === 'function' &&
    typeof candidate.listTreasuryTransfers === 'function' &&
    typeof candidate.retrieveTreasuryTransfer === 'function'
  );
}

export function isTreasuryCounterpartyCapable(
  provider: TreasuryProvider,
): provider is TreasuryProvider & TreasuryCounterpartyCapable {
  const candidate = provider as Partial<TreasuryCounterpartyCapable>;
  return (
    typeof candidate.listTreasuryCounterparties === 'function' &&
    typeof candidate.retrieveTreasuryCounterparty === 'function'
  );
}

export function isTreasuryExchangeCapable(
  provider: TreasuryProvider,
): provider is TreasuryProvider & TreasuryExchangeCapable {
  const candidate = provider as Partial<TreasuryExchangeCapable>;
  return (
    typeof candidate.quoteTreasuryExchange === 'function' &&
    typeof candidate.createTreasuryExchange === 'function'
  );
}

export function isTreasuryWebhookCapable(
  provider: TreasuryProvider,
): provider is TreasuryProvider & TreasuryWebhookCapable {
  return typeof (provider as Partial<TreasuryWebhookCapable>).verifyTreasuryWebhook === 'function';
}
