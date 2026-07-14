import type Stripe from 'stripe';
import { vi } from 'vitest';

export function stripeCardholder(
  overrides: Partial<Stripe.Issuing.Cardholder> = {},
): Stripe.Issuing.Cardholder {
  return {
    id: 'ich_1',
    object: 'issuing.cardholder',
    created: 1_725_000_000,
    email: 'jane@example.com',
    name: 'Jane Doe',
    status: 'active',
    type: 'individual',
    ...overrides,
  } as Stripe.Issuing.Cardholder;
}

export function stripeIssuingCard(
  overrides: Partial<Stripe.Issuing.Card> = {},
): Stripe.Issuing.Card {
  return {
    id: 'ic_1',
    object: 'issuing.card',
    brand: 'Visa',
    cardholder: stripeCardholder(),
    created: 1_725_000_100,
    currency: 'usd',
    exp_month: 12,
    exp_year: 2030,
    last4: '4242',
    status: 'active',
    type: 'virtual',
    cvc: '123',
    number: '4242424242424242',
    ...overrides,
  } as Stripe.Issuing.Card;
}

export function stripeIssuingAuthorization(
  overrides: Partial<Stripe.Issuing.Authorization> = {},
): Stripe.Issuing.Authorization {
  return {
    id: 'iauth_1',
    object: 'issuing.authorization',
    amount: 1500,
    approved: true,
    card: stripeIssuingCard(),
    created: 1_725_000_200,
    currency: 'usd',
    merchant_data: { name: 'Example Store' },
    status: 'pending',
    ...overrides,
  } as Stripe.Issuing.Authorization;
}

export function stripeIssuingTransaction(
  overrides: Partial<Stripe.Issuing.Transaction> = {},
): Stripe.Issuing.Transaction {
  return {
    id: 'ipi_1',
    object: 'issuing.transaction',
    amount: -1500,
    authorization: 'iauth_1',
    card: 'ic_1',
    created: 1_725_000_300,
    currency: 'usd',
    type: 'capture',
    ...overrides,
  } as Stripe.Issuing.Transaction;
}

function paging<T>(records: T[]) {
  return { autoPagingToArray: vi.fn().mockResolvedValue(records) };
}

export function fakeStripeIssuing() {
  const cardholdersCreate = vi.fn().mockResolvedValue(stripeCardholder());
  const cardholdersRetrieve = vi.fn().mockResolvedValue(stripeCardholder());
  const cardsCreate = vi.fn().mockResolvedValue(stripeIssuingCard());
  const cardsRetrieve = vi.fn().mockResolvedValue(stripeIssuingCard());
  const cardsUpdate = vi.fn().mockResolvedValue(stripeIssuingCard());
  const cardsPage = paging([stripeIssuingCard()]);
  const cardsList = vi.fn().mockReturnValue(cardsPage);
  const authorizationsRetrieve = vi.fn().mockResolvedValue(stripeIssuingAuthorization());
  const authorizationsApprove = vi.fn().mockResolvedValue(stripeIssuingAuthorization());
  const authorizationsDecline = vi
    .fn()
    .mockResolvedValue(stripeIssuingAuthorization({ approved: false, status: 'closed' }));
  const authorizationsPage = paging([stripeIssuingAuthorization()]);
  const authorizationsList = vi.fn().mockReturnValue(authorizationsPage);
  const transactionsRetrieve = vi.fn().mockResolvedValue(stripeIssuingTransaction());
  const transactionsPage = paging([stripeIssuingTransaction()]);
  const transactionsList = vi.fn().mockReturnValue(transactionsPage);
  const client = {
    issuing: {
      cardholders: { create: cardholdersCreate, retrieve: cardholdersRetrieve },
      cards: { create: cardsCreate, retrieve: cardsRetrieve, update: cardsUpdate, list: cardsList },
      authorizations: {
        retrieve: authorizationsRetrieve,
        approve: authorizationsApprove,
        decline: authorizationsDecline,
        list: authorizationsList,
      },
      transactions: { retrieve: transactionsRetrieve, list: transactionsList },
    },
  } as unknown as Stripe;
  return {
    client,
    calls: {
      cardholdersCreate,
      cardholdersRetrieve,
      cardsCreate,
      cardsRetrieve,
      cardsUpdate,
      cardsList,
      cardsPage,
      authorizationsRetrieve,
      authorizationsApprove,
      authorizationsDecline,
      authorizationsList,
      authorizationsPage,
      transactionsRetrieve,
      transactionsList,
      transactionsPage,
    },
  };
}
