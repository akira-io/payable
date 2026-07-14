import type { OperationContext } from '../dtos/common.dto';
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
} from '../dtos/issuing.dto';

export interface IssuingProvider {
  readonly name: string;
  capabilities(): IssuingCapabilities;
}

export interface IssuingCardholderCapable {
  createIssuingCardholder(
    input: CreateIssuingCardholderInput,
    ctx: OperationContext,
  ): Promise<IssuingCardholderDTO>;
  retrieveIssuingCardholder(providerCardholderId: string): Promise<IssuingCardholderDTO>;
}

export interface IssuingCardCapable {
  createIssuingCard(input: CreateIssuingCardInput, ctx: OperationContext): Promise<IssuingCardDTO>;
  listIssuingCards(input?: ListIssuingCardsInput): Promise<IssuingCardDTO[]>;
  retrieveIssuingCard(providerCardId: string): Promise<IssuingCardDTO>;
  updateIssuingCardStatus(
    providerCardId: string,
    status: IssuingCardStatus,
    ctx: OperationContext,
  ): Promise<IssuingCardDTO>;
}

export interface IssuingAuthorizationCapable {
  listIssuingAuthorizations(
    input?: ListIssuingAuthorizationsInput,
  ): Promise<IssuingAuthorizationDTO[]>;
  retrieveIssuingAuthorization(providerAuthorizationId: string): Promise<IssuingAuthorizationDTO>;
  respondIssuingAuthorization(
    input: RespondIssuingAuthorizationInput,
    ctx: OperationContext,
  ): Promise<IssuingAuthorizationDTO>;
}

export interface IssuingTransactionCapable {
  listIssuingTransactions(input?: ListIssuingTransactionsInput): Promise<IssuingTransactionDTO[]>;
  retrieveIssuingTransaction(providerTransactionId: string): Promise<IssuingTransactionDTO>;
}

export function isIssuingCardholderCapable(
  provider: IssuingProvider,
): provider is IssuingProvider & IssuingCardholderCapable {
  const candidate = provider as Partial<IssuingCardholderCapable>;
  return (
    typeof candidate.createIssuingCardholder === 'function' &&
    typeof candidate.retrieveIssuingCardholder === 'function'
  );
}

export function isIssuingCardCapable(
  provider: IssuingProvider,
): provider is IssuingProvider & IssuingCardCapable {
  const candidate = provider as Partial<IssuingCardCapable>;
  return (
    typeof candidate.createIssuingCard === 'function' &&
    typeof candidate.listIssuingCards === 'function' &&
    typeof candidate.retrieveIssuingCard === 'function' &&
    typeof candidate.updateIssuingCardStatus === 'function'
  );
}

export function isIssuingAuthorizationCapable(
  provider: IssuingProvider,
): provider is IssuingProvider & IssuingAuthorizationCapable {
  const candidate = provider as Partial<IssuingAuthorizationCapable>;
  return (
    typeof candidate.listIssuingAuthorizations === 'function' &&
    typeof candidate.retrieveIssuingAuthorization === 'function' &&
    typeof candidate.respondIssuingAuthorization === 'function'
  );
}

export function isIssuingTransactionCapable(
  provider: IssuingProvider,
): provider is IssuingProvider & IssuingTransactionCapable {
  const candidate = provider as Partial<IssuingTransactionCapable>;
  return (
    typeof candidate.listIssuingTransactions === 'function' &&
    typeof candidate.retrieveIssuingTransaction === 'function'
  );
}
