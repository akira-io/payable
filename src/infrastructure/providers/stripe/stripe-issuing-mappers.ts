import type Stripe from 'stripe';
import type {
  CreateIssuingCardholderInput,
  CreateIssuingCardInput,
  IssuingAddressDTO,
  IssuingAuthorizationDTO,
  IssuingAuthorizationStatus,
  IssuingCardDTO,
  IssuingCardholderDTO,
  IssuingCardStatus,
  IssuingTransactionDTO,
} from '../../../domain/dtos/issuing.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeAmount, stripeMoney } from './stripe-amounts';

export function stripeIssuingCardholderParams(
  input: CreateIssuingCardholderInput,
): Stripe.Issuing.CardholderCreateParams {
  if (!input.billingAddress) {
    throw issuingRequestError('Stripe Issuing requires a billing address for cardholders');
  }
  return {
    type: input.type === 'business' ? 'company' : 'individual',
    name: input.name,
    email: input.email,
    phone_number: input.phone,
    billing: { address: stripeIssuingAddress(input.billingAddress) },
    metadata: input.reference ? { payable_reference: input.reference } : undefined,
  };
}

export function stripeIssuingCardParams(
  input: CreateIssuingCardInput,
): Stripe.Issuing.CardCreateParams {
  if (!input.providerCardholderId) {
    throw issuingRequestError('Stripe Issuing requires a provider cardholder id');
  }
  const currency = input.currency ?? input.spendingLimit?.currency();
  if (!currency) {
    throw issuingRequestError('Stripe Issuing requires a card currency');
  }
  if (
    input.spendingLimit &&
    input.currency &&
    input.spendingLimit.currency().toUpperCase() !== input.currency.toUpperCase()
  ) {
    throw issuingRequestError('Stripe Issuing card and spending limit currencies must match');
  }
  if (input.form === 'physical' && !input.shipping) {
    throw issuingRequestError('Stripe Issuing requires shipping details for physical cards');
  }
  return {
    cardholder: input.providerCardholderId,
    currency: currency.toLowerCase(),
    type: input.form,
    metadata: input.label ? { payable_label: input.label } : undefined,
    shipping: input.shipping
      ? {
          name: input.shipping.name,
          phone_number: input.shipping.phone,
          address: stripeIssuingAddress(input.shipping.address),
        }
      : undefined,
    spending_controls: input.spendingLimit
      ? {
          spending_limits: [
            { amount: stripeAmount(input.spendingLimit), interval: 'per_authorization' },
          ],
        }
      : undefined,
  };
}

export function mapStripeIssuingCardholder(
  cardholder: Stripe.Issuing.Cardholder,
): IssuingCardholderDTO {
  return {
    providerCardholderId: cardholder.id,
    type: cardholder.type === 'company' ? 'business' : 'individual',
    name: cardholder.name,
    email: cardholder.email ?? null,
    status:
      cardholder.status === 'active' || cardholder.status === 'inactive'
        ? cardholder.status
        : 'unknown',
    createdAt: new Date(cardholder.created * 1000),
  };
}

export function mapStripeIssuingCard(card: Stripe.Issuing.Card): IssuingCardDTO {
  return {
    providerCardId: card.id,
    providerCardholderId: stripeExpandableId(card.cardholder),
    form: card.type,
    status: stripeIssuingCardStatus(card.status),
    brand: card.brand ?? null,
    lastFour: card.last4,
    expiryMonth: card.exp_month ?? null,
    expiryYear: card.exp_year ?? null,
    createdAt: new Date(card.created * 1000),
  };
}

export function mapStripeIssuingAuthorization(
  authorization: Stripe.Issuing.Authorization,
): IssuingAuthorizationDTO {
  return {
    providerAuthorizationId: authorization.id,
    providerCardId: stripeExpandableId(authorization.card) ?? '',
    amount: stripeMoney(authorization.amount, authorization.currency),
    status: stripeIssuingAuthorizationStatus(authorization),
    merchantName: authorization.merchant_data.name ?? null,
    createdAt: new Date(authorization.created * 1000),
  };
}

export function mapStripeIssuingTransaction(
  transaction: Stripe.Issuing.Transaction,
): IssuingTransactionDTO {
  return {
    providerTransactionId: transaction.id,
    providerCardId: stripeExpandableId(transaction.card) ?? '',
    amount: stripeMoney(transaction.amount, transaction.currency),
    type: transaction.type,
    createdAt: new Date(transaction.created * 1000),
  };
}

export function stripeIssuingListCardStatus(
  status: IssuingCardStatus | undefined,
): Stripe.Issuing.CardListParams.Status | undefined {
  if (!status) {
    return undefined;
  }
  if (status === 'active' || status === 'inactive' || status === 'canceled') {
    return status;
  }
  throw new PayableError(`Stripe Issuing cannot filter cards by ${status}`, {
    code: 'PROVIDER_OPERATION_UNSUPPORTED',
    context: { provider: 'stripe-issuing', status },
  });
}

export function stripeIssuingListAuthorizationStatus(
  status: IssuingAuthorizationStatus | undefined,
): Stripe.Issuing.AuthorizationListParams.Status | undefined {
  if (!status || status === 'unknown') {
    return undefined;
  }
  if (status === 'pending') {
    return 'pending';
  }
  if (status === 'reversed') {
    return 'reversed';
  }
  return status === 'declined' ? 'closed' : undefined;
}

export function stripeExpandableId(expanded: { id: string } | string | null): string | null {
  if (!expanded) {
    return null;
  }
  return typeof expanded === 'string' ? expanded : expanded.id;
}

function stripeIssuingAddress(address: IssuingAddressDTO) {
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.region,
    postal_code: address.postalCode,
    country: address.country,
  };
}

function stripeIssuingCardStatus(status: Stripe.Issuing.Card.Status): IssuingCardStatus {
  if (status === 'active' || status === 'inactive' || status === 'canceled') {
    return status;
  }
  return 'unknown';
}

function stripeIssuingAuthorizationStatus(
  authorization: Stripe.Issuing.Authorization,
): IssuingAuthorizationStatus {
  if (authorization.status === 'reversed') {
    return 'reversed';
  }
  if (authorization.status === 'expired') {
    return 'declined';
  }
  if (authorization.approved) {
    return 'approved';
  }
  if (authorization.status === 'closed') {
    return 'declined';
  }
  return 'pending';
}

function issuingRequestError(message: string): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_REQUEST_INVALID',
    context: { provider: 'stripe-issuing' },
  });
}
