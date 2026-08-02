import type Stripe from 'stripe';
import type {
  CreateMarketplaceAccountInput,
  CreateMarketplaceTransferInput,
  MarketplaceAccountDTO,
  MarketplaceAccountStatus,
  MarketplacePayoutDTO,
  MarketplacePayoutStatus,
  MarketplaceTransferDTO,
  MarketplaceTransferSourceReference,
} from '../../../domain/dtos/marketplace.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeAmount, stripeMoney } from './stripe-amounts';

export function stripeMarketplaceAccountParams(
  input: CreateMarketplaceAccountInput,
): Stripe.AccountCreateParams {
  return {
    business_type: input.type === 'business' ? 'company' : 'individual',
    country: input.country.toUpperCase(),
    email: input.email,
    controller: {
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      requirement_collection: 'stripe',
      stripe_dashboard: { type: 'express' },
    },
    metadata: input.reference ? { reference: input.reference } : undefined,
  };
}

export function stripeMarketplaceTransferParams(
  input: CreateMarketplaceTransferInput,
): Stripe.TransferCreateParams {
  const sourceTransaction = stripeMarketplaceSourceTransaction(input.sourceReference);

  return {
    amount: stripeAmount(input.amount),
    currency: input.amount.currency().toLowerCase(),
    destination: input.destinationProviderAccountId,
    metadata: input.reference ? { reference: input.reference } : undefined,
    ...(input.groupReference ? { transfer_group: input.groupReference } : {}),
    ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
  };
}

export function mapStripeMarketplaceAccount(account: Stripe.Account): MarketplaceAccountDTO {
  return {
    providerAccountId: account.id,
    type: account.business_type === 'individual' ? 'individual' : 'business',
    country: account.country ?? '',
    email: account.email ?? null,
    status: stripeMarketplaceAccountStatus(account),
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    requirementsDue: account.requirements?.currently_due ?? [],
    createdAt: account.created ? new Date(account.created * 1000) : null,
  };
}

export function mapStripeMarketplaceTransfer(transfer: Stripe.Transfer): MarketplaceTransferDTO {
  const destinationProviderAccountId = stripeMarketplaceId(transfer.destination);
  if (!destinationProviderAccountId) {
    throw invalidStripeMarketplaceResponse('Stripe transfer has no destination account', {
      transferId: transfer.id,
    });
  }
  return {
    providerTransferId: transfer.id,
    destinationProviderAccountId,
    amount: stripeMoney(transfer.amount, transfer.currency),
    status: transfer.reversed ? 'reversed' : 'completed',
    groupReference: transfer.transfer_group ?? null,
    sourceReference: stripeMarketplaceSourceReference(transfer.source_transaction, transfer.id),
    createdAt: new Date(transfer.created * 1000),
  };
}

function stripeMarketplaceSourceTransaction(sourceReference: unknown): string | undefined {
  if (sourceReference === undefined) {
    return undefined;
  }

  if (
    !isStripeMarketplaceChargeSourceReference(sourceReference) ||
    !isStripeMarketplaceChargeId(sourceReference.providerChargeId)
  ) {
    throw new PayableError('Stripe marketplace transfer source must be a Charge identifier', {
      code: 'PROVIDER_REQUEST_INVALID',
      context: { provider: 'stripe-connect' },
    });
  }

  return sourceReference.providerChargeId;
}

function stripeMarketplaceSourceReference(
  sourceTransaction: unknown,
  transferId: string,
): MarketplaceTransferSourceReference | null {
  if (sourceTransaction === null) {
    return null;
  }

  const providerChargeId =
    typeof sourceTransaction === 'string'
      ? sourceTransaction
      : isStripeMarketplaceResource(sourceTransaction)
        ? sourceTransaction.id
        : null;

  if (!providerChargeId || !isStripeMarketplaceChargeId(providerChargeId)) {
    throw invalidStripeMarketplaceResponse('Stripe transfer has an invalid source Charge', {
      transferId,
    });
  }

  return { type: 'charge', providerChargeId };
}

function isStripeMarketplaceChargeSourceReference(
  value: unknown,
): value is { type: 'charge'; providerChargeId: string } {
  return (
    isStripeMarketplaceRecord(value) &&
    value.type === 'charge' &&
    typeof value.providerChargeId === 'string'
  );
}

function isStripeMarketplaceResource(value: unknown): value is { id: string } {
  return isStripeMarketplaceRecord(value) && typeof value.id === 'string';
}

function isStripeMarketplaceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStripeMarketplaceChargeId(providerChargeId: string): boolean {
  return providerChargeId.startsWith('ch_') && providerChargeId.length > 'ch_'.length;
}

export function mapStripeMarketplacePayout(
  payout: Stripe.Payout,
  providerAccountId: string,
): MarketplacePayoutDTO {
  return {
    providerPayoutId: payout.id,
    providerAccountId,
    amount: stripeMoney(payout.amount, payout.currency),
    status: stripeMarketplacePayoutStatus(payout.status),
    arrivalAt: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
    createdAt: new Date(payout.created * 1000),
  };
}

function stripeMarketplaceAccountStatus(account: Stripe.Account): MarketplaceAccountStatus {
  if (account.requirements?.disabled_reason) {
    return 'disabled';
  }
  if (account.charges_enabled && account.payouts_enabled) {
    return 'active';
  }
  if (!account.details_submitted) {
    return 'pending';
  }
  if ((account.requirements?.currently_due?.length ?? 0) > 0) {
    return 'restricted';
  }
  return 'unknown';
}

function stripeMarketplacePayoutStatus(status: string): MarketplacePayoutStatus {
  if (status === 'paid' || status === 'failed' || status === 'canceled') {
    return status;
  }
  if (status === 'pending' || status === 'in_transit') {
    return 'pending';
  }
  return 'unknown';
}

function stripeMarketplaceId(resource: { id: string } | string | null): string | null {
  if (!resource) {
    return null;
  }
  return typeof resource === 'string' ? resource : resource.id;
}

function invalidStripeMarketplaceResponse(
  message: string,
  context: Record<string, unknown>,
): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_RESPONSE_INVALID',
    context: { provider: 'stripe-connect', ...context },
  });
}
