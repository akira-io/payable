import type Stripe from 'stripe';
import type {
  TreasuryAccountCapable,
  TreasuryProvider,
  TreasuryTransactionCapable,
  TreasuryTransferCapable,
  TreasuryWebhookCapable,
} from '../../../domain/contracts/treasury-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateTreasuryTransferInput,
  ListTreasuryAccountsInput,
  ListTreasuryTransactionsInput,
  ListTreasuryTransfersInput,
  TreasuryAccountDTO,
  TreasuryCapabilities,
  TreasuryTransactionDTO,
  TreasuryTransferDTO,
} from '../../../domain/dtos/treasury.dto';
import type { VerifiedTreasuryWebhook } from '../../../domain/dtos/treasury-webhook.dto';
import type { WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { StripeTreasuryAccounts } from './stripe-treasury-accounts';
import { StripeTreasuryTransactions } from './stripe-treasury-transactions';
import { StripeTreasuryTransfers } from './stripe-treasury-transfers';
import { StripeTreasuryWebhooks } from './stripe-treasury-webhooks';

export interface StripeTreasuryProviderOptions {
  secretKey: string;
  connectedAccountId: string;
  webhookSecret?: string;
}

export class StripeTreasuryProvider
  implements
    TreasuryProvider,
    TreasuryAccountCapable,
    TreasuryTransactionCapable,
    TreasuryTransferCapable,
    TreasuryWebhookCapable
{
  readonly name = 'stripe-treasury';
  private client?: Stripe;
  private readonly accounts = new StripeTreasuryAccounts(
    () => this.stripe(),
    () => this.requestOptions(),
  );
  private readonly transactions = new StripeTreasuryTransactions(
    () => this.stripe(),
    () => this.requestOptions(),
  );
  private readonly transfers = new StripeTreasuryTransfers(
    () => this.stripe(),
    () => this.requestOptions(),
  );
  private readonly webhooks = new StripeTreasuryWebhooks(
    () => this.stripe(),
    () => this.options.webhookSecret,
    () => this.options.connectedAccountId,
  );

  constructor(
    private readonly options: StripeTreasuryProviderOptions,
    client?: Stripe,
  ) {
    this.client = client;
  }

  capabilities(): TreasuryCapabilities {
    return new Set(['accounts', 'transactions', 'transfers', 'webhooks']);
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

  verifyTreasuryWebhook(input: WebhookVerificationInput): Promise<VerifiedTreasuryWebhook> {
    return this.webhooks.verify(input);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `StripeTreasuryProvider { name: '${this.name}' }`;
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey, { apiVersion: STRIPE_API_VERSION });
    return this.client;
  }

  private requestOptions(): Stripe.RequestOptions {
    return { stripeAccount: this.options.connectedAccountId };
  }
}
