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
}

export class RevolutBusinessIssuingProvider
  implements IssuingProvider, IssuingCardCapable, IssuingTransactionCapable
{
  readonly name = 'revolut-business-issuing';
  private readonly cards: RevolutBusinessCards;
  private readonly transactions: RevolutBusinessIssuingTransactions;

  constructor(options: RevolutBusinessIssuingProviderOptions) {
    const client = new RevolutBusinessClient({
      ...options,
      providerName: this.name,
    } satisfies RevolutBusinessClientOptions);
    const request = client.request.bind(client);
    this.cards = new RevolutBusinessCards(request);
    this.transactions = new RevolutBusinessIssuingTransactions(request);
  }

  capabilities(): IssuingCapabilities {
    return new Set(['cards', 'transactions']);
  }

  createIssuingCard(input: CreateIssuingCardInput, ctx: OperationContext): Promise<IssuingCardDTO> {
    return this.cards.create(input, ctx);
  }

  listIssuingCards(input?: ListIssuingCardsInput): Promise<IssuingCardDTO[]> {
    return this.cards.list(input);
  }

  retrieveIssuingCard(providerCardId: string): Promise<IssuingCardDTO> {
    return this.cards.retrieve(providerCardId);
  }

  updateIssuingCardStatus(
    providerCardId: string,
    status: IssuingCardStatus,
    _ctx: OperationContext,
  ): Promise<IssuingCardDTO> {
    return this.cards.update(providerCardId, status);
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
