import type Stripe from 'stripe';

export const financialAccount = {
  id: 'fa_1',
  nickname: 'Operating',
  status: 'open',
  country: 'US',
  supported_currencies: ['usd'],
  balance: {
    cash: { usd: 10_000 },
    inbound_pending: { usd: 250 },
    outbound_pending: { usd: 400 },
  },
  created: 1_750_000_000,
} as unknown as Stripe.Treasury.FinancialAccount;

export const treasuryTransaction = {
  id: 'trxn_1',
  amount: -1500,
  currency: 'usd',
  financial_account: 'fa_1',
  flow_type: 'outbound_transfer',
  status: 'posted',
  description: 'Vendor payment',
  created: 1_750_000_100,
  status_transitions: { posted_at: 1_750_000_200, void_at: null },
} as Stripe.Treasury.Transaction;

export const outboundTransfer = {
  id: 'obt_1',
  amount: 1500,
  currency: 'usd',
  financial_account: 'fa_1',
  destination_payment_method: 'pm_1',
  destination_payment_method_details: {
    type: 'financial_account',
    financial_account: { id: 'fa_2', network: 'stripe' },
  },
  description: 'Vendor payment',
  status: 'posted',
  created: 1_750_000_100,
  status_transitions: {
    canceled_at: null,
    failed_at: null,
    posted_at: 1_750_000_200,
    returned_at: null,
  },
} as Stripe.Treasury.OutboundTransfer;

export const outboundPayment = {
  ...outboundTransfer,
  id: 'obp_1',
  object: 'treasury.outbound_payment',
  destination_payment_method_details: null,
} as unknown as Stripe.Treasury.OutboundPayment;

export function fakeStripeTreasury() {
  const calls = new Map<string, unknown[]>();
  const list =
    (name: string, records: unknown[]) =>
    (...args: unknown[]) => {
      calls.set(name, args);
      return {
        autoPagingToArray: async ({ limit }: { limit: number }) => {
          calls.set(`${name}.paging`, [limit]);
          return records.slice(0, limit);
        },
      };
    };
  const retrieve =
    (name: string, record: unknown) =>
    (...args: unknown[]) => {
      calls.set(name, args);
      return Promise.resolve(record);
    };
  const client = {
    treasury: {
      financialAccounts: {
        list: list('accounts.list', [financialAccount]),
        retrieve: retrieve('accounts.retrieve', financialAccount),
      },
      transactions: {
        list: list('transactions.list', [treasuryTransaction]),
        retrieve: retrieve('transactions.retrieve', treasuryTransaction),
      },
      outboundTransfers: {
        create: retrieve('transfers.create', outboundTransfer),
        list: list('transfers.list', [outboundTransfer]),
        retrieve: retrieve('transfers.retrieve', outboundTransfer),
      },
      outboundPayments: {
        create: retrieve('payments.create', outboundPayment),
        list: list('payments.list', [outboundPayment]),
        retrieve: retrieve('payments.retrieve', outboundPayment),
      },
    },
  } as unknown as Stripe;
  return { client, calls };
}
