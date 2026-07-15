import type {
  TreasuryAccountCapable,
  TreasuryCounterpartyCapable,
  TreasuryExchangeCapable,
  TreasuryProvider,
  TreasuryTransactionCapable,
  TreasuryTransferCapable,
  TreasuryWebhookCapable,
} from '../../../domain/contracts/treasury-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
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
} from '../../../domain/dtos/treasury.dto';
import type { VerifiedTreasuryWebhook } from '../../../domain/dtos/treasury-webhook.dto';
import type { WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { RevolutBusinessAccounts } from './revolut-business-accounts';
import {
  RevolutBusinessClient,
  type RevolutBusinessClientOptions,
  type RevolutBusinessTokenProvider,
} from './revolut-business-client';
import { RevolutBusinessCounterparties } from './revolut-business-counterparties';
import { RevolutBusinessExchange } from './revolut-business-exchange';
import { RevolutBusinessTransactions } from './revolut-business-transactions';
import { RevolutBusinessTransfers } from './revolut-business-transfers';
import type { RevolutBusinessEnvironment, RevolutBusinessFetch } from './revolut-business-types';
import { RevolutBusinessWebhooks } from './revolut-business-webhooks';

export type { RevolutBusinessTokenProvider } from './revolut-business-client';

export interface RevolutBusinessTreasuryProviderOptions {
  tokenProvider: RevolutBusinessTokenProvider;
  environment?: RevolutBusinessEnvironment;
  baseUrl?: string;
  fetch?: RevolutBusinessFetch;
  timeoutMs?: number;
  webhookSecret?: string;
  webhookToleranceMs?: number;
}

export class RevolutBusinessTreasuryProvider
  implements
    TreasuryProvider,
    TreasuryAccountCapable,
    TreasuryTransactionCapable,
    TreasuryTransferCapable,
    TreasuryCounterpartyCapable,
    TreasuryExchangeCapable,
    TreasuryWebhookCapable
{
  readonly name = 'revolut-business-treasury';
  private readonly accounts: RevolutBusinessAccounts;
  private readonly transactions: RevolutBusinessTransactions;
  private readonly transfers: RevolutBusinessTransfers;
  private readonly counterparties: RevolutBusinessCounterparties;
  private readonly exchange: RevolutBusinessExchange;
  private readonly webhooks: RevolutBusinessWebhooks;

  constructor(options: RevolutBusinessTreasuryProviderOptions) {
    const client = new RevolutBusinessClient(options satisfies RevolutBusinessClientOptions);
    const request = client.request.bind(client);
    this.accounts = new RevolutBusinessAccounts(request);
    this.transactions = new RevolutBusinessTransactions(request);
    this.transfers = new RevolutBusinessTransfers(request);
    this.counterparties = new RevolutBusinessCounterparties(request);
    this.exchange = new RevolutBusinessExchange(request);
    this.webhooks = new RevolutBusinessWebhooks(options.webhookSecret, options.webhookToleranceMs);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `RevolutBusinessTreasuryProvider { name: '${this.name}' }`;
  }

  capabilities(): TreasuryCapabilities {
    return new Set([
      'accounts',
      'transactions',
      'transfers',
      'counterparties',
      'exchange',
      'webhooks',
    ]);
  }

  listTreasuryAccounts(input?: ListTreasuryAccountsInput): Promise<TreasuryAccountDTO[]> {
    return this.accounts.list(input);
  }

  retrieveTreasuryAccount(providerAccountId: string): Promise<TreasuryAccountDTO> {
    return this.accounts.retrieve(providerAccountId);
  }

  listTreasuryTransactions(
    input: ListTreasuryTransactionsInput,
  ): Promise<TreasuryTransactionDTO[]> {
    return this.transactions.list(input);
  }

  retrieveTreasuryTransaction(providerTransactionId: string): Promise<TreasuryTransactionDTO> {
    return this.transactions.retrieve(providerTransactionId);
  }

  createTreasuryTransfer(
    input: CreateTreasuryTransferInput,
    context: OperationContext,
  ): Promise<TreasuryTransferDTO> {
    return this.transfers.create(input, context);
  }

  listTreasuryTransfers(input: ListTreasuryTransfersInput): Promise<TreasuryTransferDTO[]> {
    return this.transfers.list(input);
  }

  retrieveTreasuryTransfer(providerTransferId: string): Promise<TreasuryTransferDTO> {
    return this.transfers.retrieve(providerTransferId);
  }

  listTreasuryCounterparties(
    input?: ListTreasuryCounterpartiesInput,
  ): Promise<TreasuryCounterpartyDTO[]> {
    return this.counterparties.list(input);
  }

  retrieveTreasuryCounterparty(providerCounterpartyId: string): Promise<TreasuryCounterpartyDTO> {
    return this.counterparties.retrieve(providerCounterpartyId);
  }

  quoteTreasuryExchange(input: TreasuryExchangeQuoteInput): Promise<TreasuryExchangeQuoteDTO> {
    return this.exchange.quote(input);
  }

  createTreasuryExchange(
    input: CreateTreasuryExchangeInput,
    context: OperationContext,
  ): Promise<TreasuryExchangeDTO> {
    return this.exchange.create(input, context);
  }

  async verifyTreasuryWebhook(input: WebhookVerificationInput): Promise<VerifiedTreasuryWebhook> {
    return this.webhooks.verify(input);
  }
}
