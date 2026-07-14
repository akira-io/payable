import type Stripe from 'stripe';
import type {
  IssuingAuthorizationCapable,
  IssuingCardCapable,
  IssuingCardholderCapable,
  IssuingProvider,
  IssuingTransactionCapable,
} from '../../../domain/contracts/issuing-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateIssuingCardholderInput,
  CreateIssuingCardInput,
  IssuingAuthorizationDTO,
  IssuingCapabilities,
  IssuingCardDTO,
  IssuingCardholderDTO,
  IssuingCardStatus,
  IssuingTransactionDTO,
  ListIssuingAuthorizationsInput,
  ListIssuingCardsInput,
  ListIssuingTransactionsInput,
  RespondIssuingAuthorizationInput,
} from '../../../domain/dtos/issuing.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { withStripeErrors } from './stripe-errors';
import {
  mapStripeIssuingAuthorization,
  mapStripeIssuingCard,
  mapStripeIssuingCardholder,
  mapStripeIssuingTransaction,
  stripeExpandableId,
  stripeIssuingCardholderParams,
  stripeIssuingCardParams,
  stripeIssuingListAuthorizationStatus,
  stripeIssuingListCardStatus,
} from './stripe-issuing-mappers';

const DEFAULT_LIST_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export interface StripeIssuingProviderOptions {
  secretKey: string;
}

export class StripeIssuingProvider
  implements
    IssuingProvider,
    IssuingCardholderCapable,
    IssuingCardCapable,
    IssuingAuthorizationCapable,
    IssuingTransactionCapable
{
  readonly name = 'stripe-issuing';
  private client?: Stripe;

  constructor(
    private readonly options: StripeIssuingProviderOptions,
    client?: unknown,
  ) {
    this.client = client as Stripe | undefined;
  }

  capabilities(): IssuingCapabilities {
    return new Set(['cardholders', 'cards', 'authorizations', 'transactions']);
  }

  async createIssuingCardholder(
    input: CreateIssuingCardholderInput,
    ctx: OperationContext,
  ): Promise<IssuingCardholderDTO> {
    const params = stripeIssuingCardholderParams(input);
    const stripe = await this.stripe();
    const cardholder = await withStripeErrors(
      () => stripe.issuing.cardholders.create(params, this.idempotency(ctx)),
      this.name,
    );
    return mapStripeIssuingCardholder(cardholder);
  }

  async retrieveIssuingCardholder(providerCardholderId: string): Promise<IssuingCardholderDTO> {
    const stripe = await this.stripe();
    const cardholder = await withStripeErrors(
      () => stripe.issuing.cardholders.retrieve(providerCardholderId),
      this.name,
    );
    return mapStripeIssuingCardholder(cardholder);
  }

  async createIssuingCard(
    input: CreateIssuingCardInput,
    ctx: OperationContext,
  ): Promise<IssuingCardDTO> {
    const params = stripeIssuingCardParams(input);
    const stripe = await this.stripe();
    const card = await withStripeErrors(
      () => stripe.issuing.cards.create(params, this.idempotency(ctx)),
      this.name,
    );
    return mapStripeIssuingCard(card);
  }

  async listIssuingCards(input: ListIssuingCardsInput = {}): Promise<IssuingCardDTO[]> {
    const stripe = await this.stripe();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const cards = await withStripeErrors(
      () =>
        stripe.issuing.cards
          .list({
            cardholder: input.providerCardholderId,
            status: stripeIssuingListCardStatus(input.status),
            limit: Math.min(limit, STRIPE_PAGE_LIMIT),
          })
          .autoPagingToArray({ limit }),
      this.name,
    );
    return cards.map(mapStripeIssuingCard);
  }

  async retrieveIssuingCard(providerCardId: string): Promise<IssuingCardDTO> {
    const stripe = await this.stripe();
    const card = await withStripeErrors(
      () => stripe.issuing.cards.retrieve(providerCardId),
      this.name,
    );
    return mapStripeIssuingCard(card);
  }

  async updateIssuingCardStatus(
    providerCardId: string,
    status: IssuingCardStatus,
    ctx: OperationContext,
  ): Promise<IssuingCardDTO> {
    if (status === 'blocked' || status === 'unknown') {
      throw new PayableError(`Stripe Issuing does not support the ${status} card status`, {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: this.name, status },
      });
    }
    const stripe = await this.stripe();
    const card = await withStripeErrors(
      () => stripe.issuing.cards.update(providerCardId, { status }, this.idempotency(ctx)),
      this.name,
    );
    return mapStripeIssuingCard(card);
  }

  async listIssuingAuthorizations(
    input: ListIssuingAuthorizationsInput = {},
  ): Promise<IssuingAuthorizationDTO[]> {
    const stripe = await this.stripe();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const authorizations = await withStripeErrors(
      () =>
        stripe.issuing.authorizations
          .list({
            card: input.providerCardId,
            status: stripeIssuingListAuthorizationStatus(input.status),
            limit: Math.min(limit, STRIPE_PAGE_LIMIT),
          })
          .autoPagingToArray({ limit }),
      this.name,
    );
    const mapped = authorizations.map(mapStripeIssuingAuthorization);
    if (!input.status) {
      return mapped;
    }
    return mapped.filter((authorization) => authorization.status === input.status);
  }

  async retrieveIssuingAuthorization(
    providerAuthorizationId: string,
  ): Promise<IssuingAuthorizationDTO> {
    const stripe = await this.stripe();
    const authorization = await withStripeErrors(
      () => stripe.issuing.authorizations.retrieve(providerAuthorizationId),
      this.name,
    );
    return mapStripeIssuingAuthorization(authorization);
  }

  async respondIssuingAuthorization(
    input: RespondIssuingAuthorizationInput,
    ctx: OperationContext,
  ): Promise<IssuingAuthorizationDTO> {
    const stripe = await this.stripe();
    const operation = input.decision === 'approve' ? 'approve' : 'decline';
    const authorization = await withStripeErrors(
      () =>
        stripe.issuing.authorizations[operation](
          input.providerAuthorizationId,
          {},
          this.idempotency(ctx),
        ),
      this.name,
    );
    return mapStripeIssuingAuthorization(authorization);
  }

  async listIssuingTransactions(
    input: ListIssuingTransactionsInput = {},
  ): Promise<IssuingTransactionDTO[]> {
    const stripe = await this.stripe();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const transactions = await withStripeErrors(
      () =>
        stripe.issuing.transactions
          .list({ card: input.providerCardId, limit: Math.min(limit, STRIPE_PAGE_LIMIT) })
          .autoPagingToArray({ limit }),
      this.name,
    );
    return transactions
      .filter(
        (transaction) =>
          !input.providerAuthorizationId ||
          stripeExpandableId(transaction.authorization) === input.providerAuthorizationId,
      )
      .map(mapStripeIssuingTransaction);
  }

  async retrieveIssuingTransaction(providerTransactionId: string): Promise<IssuingTransactionDTO> {
    const stripe = await this.stripe();
    const transaction = await withStripeErrors(
      () => stripe.issuing.transactions.retrieve(providerTransactionId),
      this.name,
    );
    return mapStripeIssuingTransaction(transaction);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `StripeIssuingProvider { name: '${this.name}' }`;
  }

  private idempotency(ctx: OperationContext): Stripe.RequestOptions {
    return { idempotencyKey: ctx.idempotencyKey };
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey, { apiVersion: STRIPE_API_VERSION });
    return this.client;
  }
}
