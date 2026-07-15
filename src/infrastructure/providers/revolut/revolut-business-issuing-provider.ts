import type {
  IssuingCardCapable,
  IssuingProvider,
  IssuingTransactionCapable,
} from '../../../domain/contracts/issuing-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateIssuingCardInput,
  IssuingCapabilities,
  IssuingCardDTO,
  IssuingCardStatus,
  IssuingTransactionDTO,
  ListIssuingCardsInput,
  ListIssuingTransactionsInput,
} from '../../../domain/dtos/issuing.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { RevolutBusinessCards } from './revolut-business-cards';
import {
  RevolutBusinessClient,
  type RevolutBusinessClientOptions,
  type RevolutBusinessTokenProvider,
} from './revolut-business-client';
import { RevolutBusinessIssuingTransactions } from './revolut-business-issuing-transactions';
import type { RevolutBusinessEnvironment, RevolutBusinessFetch } from './revolut-business-types';

export interface RevolutBusinessIssuingProviderOptions {
  tokenProvider: RevolutBusinessTokenProvider;
  environment?: RevolutBusinessEnvironment;
  baseUrl?: string;
  fetch?: RevolutBusinessFetch;
  timeoutMs?: number;
}

export class RevolutBusinessIssuingProvider
  implements IssuingProvider, IssuingCardCapable, IssuingTransactionCapable
{
  readonly name = 'revolut-business-issuing';
  private readonly cards: RevolutBusinessCards;
  private readonly transactions: RevolutBusinessIssuingTransactions;
  private readonly sandbox: boolean;

  constructor(options: RevolutBusinessIssuingProviderOptions) {
    const client = new RevolutBusinessClient({
      ...options,
      providerName: this.name,
    } satisfies RevolutBusinessClientOptions);
    const request = client.request.bind(client);
    this.sandbox = options.environment === 'sandbox';
    this.cards = new RevolutBusinessCards(request);
    this.transactions = new RevolutBusinessIssuingTransactions(request);
  }

  capabilities(): IssuingCapabilities {
    return this.sandbox ? new Set(['transactions']) : new Set(['cards', 'transactions']);
  }

  async createIssuingCard(
    input: CreateIssuingCardInput,
    ctx: OperationContext,
  ): Promise<IssuingCardDTO> {
    this.assertCardsAvailable('createIssuingCard');
    return this.cards.create(input, ctx);
  }

  async listIssuingCards(input?: ListIssuingCardsInput): Promise<IssuingCardDTO[]> {
    this.assertCardsAvailable('listIssuingCards');
    return this.cards.list(input);
  }

  async retrieveIssuingCard(providerCardId: string): Promise<IssuingCardDTO> {
    this.assertCardsAvailable('retrieveIssuingCard');
    return this.cards.retrieve(providerCardId);
  }

  async updateIssuingCardStatus(
    providerCardId: string,
    status: IssuingCardStatus,
    _ctx: OperationContext,
  ): Promise<IssuingCardDTO> {
    this.assertCardsAvailable('updateIssuingCardStatus');
    return this.cards.update(providerCardId, status);
  }

  private assertCardsAvailable(operation: string): void {
    if (this.sandbox) {
      throw new PayableError('The Revolut Business Cards API is unavailable in sandbox', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: this.name, operation, environment: 'sandbox' },
      });
    }
  }

  listIssuingTransactions(input?: ListIssuingTransactionsInput): Promise<IssuingTransactionDTO[]> {
    return this.transactions.list(input);
  }

  retrieveIssuingTransaction(providerTransactionId: string): Promise<IssuingTransactionDTO> {
    return this.transactions.retrieve(providerTransactionId);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `RevolutBusinessIssuingProvider { name: '${this.name}' }`;
  }
}
