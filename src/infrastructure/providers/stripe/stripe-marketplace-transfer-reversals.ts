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
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
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

function validateIdentifier(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw invalidReversalInput(`${field} must not be empty`, { field });
  }
}

function validatePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw invalidReversalInput(`${field} must be a positive integer`, { field });
  }
}

function invalidReversalInput(message: string, context: Record<string, unknown>): PayableError {
  return new PayableError(message, {
    code: 'MARKETPLACE_TRANSFER_REVERSAL_INVALID',
    context: { provider: 'stripe-connect', ...context },
  });
}

function mapStripeMarketplaceTransferReversal(
  reversal: Stripe.TransferReversal,
): MarketplaceTransferReversalDTO {
  const providerTransferId =
    typeof reversal.transfer === 'string' ? reversal.transfer : reversal.transfer.id;
  if (providerTransferId.trim().length === 0) {
    throw new PayableError('Stripe transfer reversal has no transfer identifier', {
      code: 'PROVIDER_RESPONSE_INVALID',
      context: { provider: 'stripe-connect', providerReversalId: reversal.id },
    });
  }
  const reference = reversal.metadata?.reference;
  return {
    providerReversalId: reversal.id,
    providerTransferId,
    amount: stripeMoney(reversal.amount, reversal.currency),
    reference: typeof reference === 'string' ? reference : null,
    createdAt: new Date(reversal.created * 1000),
  };
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
