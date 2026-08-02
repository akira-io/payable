import type Stripe from 'stripe';
import type { MarketplaceTransferReversalCapable } from '../../../domain/contracts/marketplace-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateMarketplaceTransferReversalInput,
  ListMarketplaceTransferReversalsInput,
  MarketplaceTransferReversalDTO,
} from '../../../domain/dtos/marketplace.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeMoney } from './stripe-amounts';
import { withStripeErrors } from './stripe-errors';

const DEFAULT_LIST_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripeMarketplaceTransferReversals implements MarketplaceTransferReversalCapable {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async createMarketplaceTransferReversal(
    input: CreateMarketplaceTransferReversalInput,
    ctx: OperationContext,
  ): Promise<MarketplaceTransferReversalDTO> {
    validateCreateInput(input);
    const stripe = await this.client();
    const reversal = await withStripeErrors(
      () =>
        stripe.transfers.createReversal(
          input.providerTransferId,
          {
            ...(input.amount === undefined ? {} : { amount: input.amount }),
            ...(input.reference ? { metadata: { reference: input.reference } } : {}),
          },
          { idempotencyKey: ctx.idempotencyKey },
        ),
      'stripe-connect',
      undefined,
      resolveReversalErrorCode,
    );
    return mapStripeMarketplaceTransferReversal(reversal);
  }

  async retrieveMarketplaceTransferReversal(
    providerTransferId: string,
    providerReversalId: string,
  ): Promise<MarketplaceTransferReversalDTO> {
    validateIdentifier(providerTransferId, 'providerTransferId');
    validateIdentifier(providerReversalId, 'providerReversalId');
    const stripe = await this.client();
    const reversal = await withStripeErrors(
      () => stripe.transfers.retrieveReversal(providerTransferId, providerReversalId),
      'stripe-connect',
    );
    return mapStripeMarketplaceTransferReversal(reversal);
  }

  async listMarketplaceTransferReversals(
    input: ListMarketplaceTransferReversalsInput,
  ): Promise<MarketplaceTransferReversalDTO[]> {
    validateIdentifier(input.providerTransferId, 'providerTransferId');
    const limit = input.limit === undefined ? DEFAULT_LIST_LIMIT : input.limit;
    validatePositiveInteger(limit, 'limit');
    const stripe = await this.client();
    const reversals = await withStripeErrors(
      () =>
        stripe.transfers
          .listReversals(input.providerTransferId, {
            limit: Math.min(limit, STRIPE_PAGE_LIMIT),
          })
          .autoPagingToArray({ limit }),
      'stripe-connect',
    );
    return reversals.map(mapStripeMarketplaceTransferReversal);
  }
}

function validateCreateInput(input: CreateMarketplaceTransferReversalInput): void {
  validateIdentifier(input.providerTransferId, 'providerTransferId');
  if (input.amount !== undefined) {
    validatePositiveInteger(input.amount, 'amount');
  }
}

function validateIdentifier(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidReversalInput(`${field} must not be empty`, { field });
  }
}

function validatePositiveInteger(candidate: unknown, field: string): void {
  if (!Number.isSafeInteger(candidate) || typeof candidate !== 'number' || candidate <= 0) {
    throw invalidReversalInput(`${field} must be a positive integer`, { field });
  }
}

function invalidReversalInput(message: string, context: Record<string, unknown>): PayableError {
  return new PayableError(message, {
    code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID',
    context: { provider: 'stripe-connect', ...context },
  });
}

function mapStripeMarketplaceTransferReversal(reversal: unknown): MarketplaceTransferReversalDTO {
  const reversalRecord = requireReversalRecord(reversal);
  const providerReversalId = requireResponseString(reversalRecord.id, 'id');
  const providerTransferId = requireTransferId(reversalRecord.transfer, providerReversalId);
  const amount = requireResponsePositiveInteger(
    reversalRecord.amount,
    'amount',
    providerReversalId,
  );
  const currency = requireResponseString(reversalRecord.currency, 'currency', providerReversalId);
  const createdAt = requireResponseCreatedAt(reversalRecord.created, providerReversalId);
  const reference = isRecord(reversalRecord.metadata)
    ? reversalRecord.metadata.reference
    : undefined;
  return {
    providerReversalId,
    providerTransferId,
    amount: stripeMoney(amount, currency),
    reference: typeof reference === 'string' ? reference : null,
    createdAt,
  };
}

function requireReversalRecord(reversal: unknown): Record<string, unknown> {
  if (!isRecord(reversal)) {
    throw invalidReversalResponse('response');
  }
  return reversal;
}

function requireTransferId(candidate: unknown, providerReversalId: string): string {
  if (typeof candidate === 'string') {
    return requireResponseString(candidate, 'transfer', providerReversalId);
  }
  if (!isRecord(candidate)) {
    throw invalidReversalResponse('transfer', providerReversalId);
  }
  return requireResponseString(candidate.id, 'transfer', providerReversalId);
}

function requireResponseString(
  candidate: unknown,
  field: string,
  providerReversalId?: string,
): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw invalidReversalResponse(field, providerReversalId);
  }
  return candidate;
}

function requireResponsePositiveInteger(
  candidate: unknown,
  field: string,
  providerReversalId: string,
): number {
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0) {
    throw invalidReversalResponse(field, providerReversalId);
  }
  return candidate;
}

function requireResponseCreatedAt(candidate: unknown, providerReversalId: string): Date {
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
    throw invalidReversalResponse('created', providerReversalId);
  }
  const createdAt = new Date(candidate * 1000);
  if (Number.isNaN(createdAt.getTime())) {
    throw invalidReversalResponse('created', providerReversalId);
  }
  return createdAt;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function invalidReversalResponse(field: string, providerReversalId?: string): PayableError {
  return new PayableError(`Stripe transfer reversal response has an invalid ${field}`, {
    code: 'PROVIDER_RESPONSE_INVALID',
    context: {
      provider: 'stripe-connect',
      field,
      ...(providerReversalId === undefined ? {} : { providerReversalId }),
    },
  });
}

function resolveReversalErrorCode(
  error: Readonly<{ type?: string; code?: string }>,
): string | undefined {
  if (error.code === 'balance_insufficient') {
    return 'MARKETPLACE_TRANSFER_REVERSAL_INSUFFICIENT_BALANCE';
  }
  if (error.code === 'amount_too_large') {
    return 'MARKETPLACE_TRANSFER_REVERSAL_AMOUNT_EXCEEDED';
  }
  if (error.type === 'StripeInvalidRequestError') {
    return 'MARKETPLACE_TRANSFER_REVERSAL_INVALID';
  }
  return undefined;
}
