import type Stripe from 'stripe';
import { vi } from 'vitest';

export function stripeMarketplaceAccount(overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id: 'acct_1',
    object: 'account',
    business_type: 'company',
    charges_enabled: true,
    country: 'US',
    created: 1_725_000_000,
    details_submitted: true,
    email: 'seller@example.com',
    payouts_enabled: true,
    requirements: {
      alternatives: [],
      current_deadline: null,
      currently_due: [],
      disabled_reason: null,
      errors: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
    },
    type: 'none',
    ...overrides,
  } as Stripe.Account;
}

export function stripeMarketplaceTransfer(
  overrides: Partial<Stripe.Transfer> = {},
): Stripe.Transfer {
  return {
    id: 'tr_1',
    object: 'transfer',
    amount: 12_345,
    amount_reversed: 0,
    balance_transaction: null,
    created: 1_725_000_100,
    currency: 'usd',
    description: null,
    destination: 'acct_1',
    livemode: false,
    metadata: {},
    reversals: { object: 'list', data: [], has_more: false, url: '/v1/transfers/tr_1/reversals' },
    reversed: false,
    source_transaction: 'ch_1',
    transfer_group: 'order-1',
    ...overrides,
  } as Stripe.Transfer;
}

export function stripeMarketplaceTransferReversal(
  overrides: Partial<Stripe.TransferReversal> = {},
): Stripe.TransferReversal {
  return {
    id: 'trr_1',
    object: 'transfer_reversal',
    amount: 400,
    balance_transaction: null,
    created: 1_725_000_300,
    currency: 'usd',
    destination_payment_refund: null,
    metadata: { reference: 'order-1-reversal' },
    source_refund: null,
    transfer: 'tr_1',
    ...overrides,
  } as Stripe.TransferReversal;
}

export function stripeMarketplacePayout(overrides: Partial<Stripe.Payout> = {}): Stripe.Payout {
  return {
    id: 'po_1',
    object: 'payout',
    amount: 9_000,
    application_fee: null,
    application_fee_amount: null,
    arrival_date: 1_725_086_400,
    automatic: false,
    balance_transaction: null,
    created: 1_725_000_200,
    currency: 'usd',
    description: null,
    destination: null,
    failure_balance_transaction: null,
    failure_code: null,
    failure_message: null,
    livemode: false,
    metadata: {},
    method: 'standard',
    original_payout: null,
    payout_method: null,
    reconciliation_status: 'not_applicable',
    reversed_by: null,
    source_type: 'card',
    statement_descriptor: null,
    status: 'in_transit',
    trace_id: null,
    type: 'bank_account',
    ...overrides,
  } as Stripe.Payout;
}

export function fakeStripeMarketplace() {
  const account = stripeMarketplaceAccount();
  const restrictedAccount = stripeMarketplaceAccount({
    id: 'acct_2',
    charges_enabled: false,
    payouts_enabled: false,
    requirements: {
      alternatives: [],
      current_deadline: null,
      currently_due: ['individual.verification.document'],
      disabled_reason: null,
      errors: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
    },
  });
  const transfer = stripeMarketplaceTransfer();
  const transferReversal = stripeMarketplaceTransferReversal();
  const payout = stripeMarketplacePayout();
  const accountsPage = {
    autoPagingToArray: vi.fn().mockResolvedValue([account, restrictedAccount]),
    async *[Symbol.asyncIterator]() {
      yield* [account, restrictedAccount];
    },
  };
  const transfersPage = { autoPagingToArray: vi.fn().mockResolvedValue([transfer]) };
  const transferReversalsPage = {
    autoPagingToArray: vi.fn().mockResolvedValue([transferReversal]),
  };
  const payoutsPage = { autoPagingToArray: vi.fn().mockResolvedValue([payout]) };
  const calls = {
    accountsCreate: vi.fn().mockResolvedValue(account),
    accountsRetrieve: vi.fn().mockResolvedValue(account),
    accountsList: vi.fn().mockReturnValue(accountsPage),
    accountLinksCreate: vi.fn().mockResolvedValue({
      object: 'account_link',
      created: 1_725_000_000,
      expires_at: 1_725_003_600,
      url: 'https://connect.stripe.test/onboarding',
    }),
    transfersCreate: vi.fn().mockResolvedValue(transfer),
    transfersCreateReversal: vi.fn().mockResolvedValue(transferReversal),
    transfersList: vi.fn().mockReturnValue(transfersPage),
    transfersListReversals: vi.fn().mockReturnValue(transferReversalsPage),
    transfersRetrieve: vi.fn().mockResolvedValue(transfer),
    transfersRetrieveReversal: vi.fn().mockResolvedValue(transferReversal),
    payoutsCreate: vi.fn().mockResolvedValue(payout),
    payoutsList: vi.fn().mockReturnValue(payoutsPage),
    payoutsRetrieve: vi.fn().mockResolvedValue(payout),
    accountsPage,
    transfersPage,
    transferReversalsPage,
    payoutsPage,
  };
  const client = {
    accounts: {
      create: calls.accountsCreate,
      retrieve: calls.accountsRetrieve,
      list: calls.accountsList,
    },
    accountLinks: { create: calls.accountLinksCreate },
    transfers: {
      create: calls.transfersCreate,
      createReversal: calls.transfersCreateReversal,
      list: calls.transfersList,
      listReversals: calls.transfersListReversals,
      retrieve: calls.transfersRetrieve,
      retrieveReversal: calls.transfersRetrieveReversal,
    },
    payouts: {
      create: calls.payoutsCreate,
      list: calls.payoutsList,
      retrieve: calls.payoutsRetrieve,
    },
  } as unknown as Stripe;
  return { client, calls };
}
