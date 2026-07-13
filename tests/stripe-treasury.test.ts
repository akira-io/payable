import { inspect } from 'node:util';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  isTreasuryAccountCapable,
  isTreasuryCounterpartyCapable,
  isTreasuryExchangeCapable,
  isTreasuryTransactionCapable,
  isTreasuryTransferCapable,
} from '../src/domain/contracts/treasury-provider.contract';
import { Money } from '../src/domain/value-objects/money';
import { StripeTreasuryProvider } from '../src/infrastructure/providers/stripe/stripe-treasury-provider';
import { fakeStripeTreasury, outboundPayment } from './support/stripe-treasury';

function subject(client: Stripe): StripeTreasuryProvider {
  return new StripeTreasuryProvider({ secretKey: 'sk_test', connectedAccountId: 'acct_1' }, client);
}

const context = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

describe('Stripe Treasury provider', () => {
  it('does not expose the secret key when serialized or inspected', () => {
    const instance = new StripeTreasuryProvider({
      secretKey: 'sk_live_secret',
      connectedAccountId: 'acct_1',
    });

    expect(JSON.stringify(instance)).not.toContain('sk_live_secret');
    expect(inspect(instance)).not.toContain('sk_live_secret');
  });

  it('declares only the Treasury capabilities it implements', () => {
    const instance = subject(fakeStripeTreasury().client);

    expect(instance.capabilities()).toEqual(new Set(['accounts', 'transactions', 'transfers']));
    expect(isTreasuryAccountCapable(instance)).toBe(true);
    expect(isTreasuryTransactionCapable(instance)).toBe(true);
    expect(isTreasuryTransferCapable(instance)).toBe(true);
    expect(isTreasuryCounterpartyCapable(instance)).toBe(false);
    expect(isTreasuryExchangeCapable(instance)).toBe(false);
  });

  it('lists normalized financial account balances with bounded pagination', async () => {
    const { client, calls } = fakeStripeTreasury();
    const instance = subject(client);
    const [account] = await instance.listTreasuryAccounts({ limit: 250 });
    await instance.retrieveTreasuryAccount('fa_1');

    expect(calls.get('accounts.list')).toEqual([{ limit: 100 }, { stripeAccount: 'acct_1' }]);
    expect(calls.get('accounts.list.paging')).toEqual([250]);
    expect(calls.get('accounts.retrieve')).toEqual(['fa_1', {}, { stripeAccount: 'acct_1' }]);
    expect(account?.providerAccountId).toBe('fa_1');
    expect(account?.balances[0]?.current.amount()).toBe(10_650);
    expect(account?.balances[0]?.available?.amount()).toBe(10_000);
    expect(account?.balances[0]?.inboundPending?.amount()).toBe(250);
    expect(account?.balances[0]?.outboundPending?.amount()).toBe(400);
  });

  it('lists account transactions with date filters and normalized lifecycle', async () => {
    const { client, calls } = fakeStripeTreasury();
    const instance = subject(client);
    const [mapped] = await instance.listTreasuryTransactions({
      providerAccountId: 'fa_1',
      from: new Date(1_700_000_000_000),
      to: new Date(1_800_000_000_000),
      limit: 20,
    });
    await instance.retrieveTreasuryTransaction('trxn_1');

    expect(calls.get('transactions.list')).toEqual([
      { financial_account: 'fa_1', created: { gte: 1_700_000_000, lte: 1_800_000_000 }, limit: 20 },
      { stripeAccount: 'acct_1' },
    ]);
    expect(calls.get('transactions.retrieve')).toEqual(['trxn_1', {}, { stripeAccount: 'acct_1' }]);
    expect(mapped?.status).toBe('completed');
    expect(mapped?.type).toBe('outbound_transfer');
    expect(mapped?.legs[0]?.amount.amount()).toBe(-1500);
  });

  it('creates an account transfer and forwards idempotency', async () => {
    const { client, calls } = fakeStripeTreasury();
    const mapped = await subject(client).createTreasuryTransfer(
      {
        sourceProviderAccountId: 'fa_1',
        destination: { type: 'account', providerAccountId: 'fa_2' },
        amount: Money.of(1500, 'USD'),
        reference: 'Vendor payment',
      },
      context,
    );

    expect(calls.get('transfers.create')).toEqual([
      {
        amount: 1500,
        currency: 'usd',
        financial_account: 'fa_1',
        description: 'Vendor payment',
        destination_payment_method_data: { type: 'financial_account', financial_account: 'fa_2' },
      },
      { idempotencyKey: 'idem-1', stripeAccount: 'acct_1' },
    ]);
    expect(mapped).toMatchObject({
      status: 'completed',
      destination: { type: 'account', providerAccountId: 'fa_2' },
    });
  });

  it('rejects counterparty transfers before calling Stripe', async () => {
    const { client, calls } = fakeStripeTreasury();

    await expect(
      subject(client).createTreasuryTransfer(
        {
          sourceProviderAccountId: 'fa_1',
          destination: { type: 'counterparty', providerCounterpartyId: 'cp_1' },
          amount: Money.of(1500, 'USD'),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TREASURY_DESTINATION_UNSUPPORTED' });
    expect(calls.has('transfers.create')).toBe(false);
  });

  it('uses Outbound Payments for third-party payment methods', async () => {
    const { client, calls } = fakeStripeTreasury();
    const mapped = await subject(client).createTreasuryTransfer(
      {
        sourceProviderAccountId: 'fa_1',
        destination: { type: 'payment_method', providerPaymentMethodId: 'pm_1' },
        amount: Money.of(1500, 'USD'),
      },
      context,
    );

    expect(calls.get('payments.create')).toEqual([
      {
        amount: 1500,
        currency: 'usd',
        financial_account: 'fa_1',
        description: undefined,
        destination_payment_method: 'pm_1',
      },
      { idempotencyKey: 'idem-1', stripeAccount: 'acct_1' },
    ]);
    expect(mapped.destination).toEqual({
      type: 'payment_method',
      providerPaymentMethodId: 'pm_1',
    });
  });

  it('preserves historical payments whose destination id is unavailable', async () => {
    const list = (records: unknown[]) => () => ({
      autoPagingToArray: async () => records,
    });
    const client = {
      treasury: {
        outboundTransfers: { list: list([]) },
        outboundPayments: {
          list: list([{ ...outboundPayment, destination_payment_method: null }]),
        },
      },
    } as unknown as Stripe;

    const [mapped] = await subject(client).listTreasuryTransfers({
      providerAccountId: 'fa_1',
    });

    expect(mapped?.destination).toBeNull();
  });

  it('lists and retrieves transfers through the normalized boundary', async () => {
    const { client, calls } = fakeStripeTreasury();
    const instance = subject(client);

    const listed = await instance.listTreasuryTransfers({ providerAccountId: 'fa_1', limit: 2 });
    await instance.retrieveTreasuryTransfer('obt_1');
    await instance.retrieveTreasuryTransfer('obp_1');

    expect(calls.get('transfers.list')).toEqual([
      { financial_account: 'fa_1', limit: 2 },
      { stripeAccount: 'acct_1' },
    ]);
    expect(calls.get('payments.list')).toEqual([
      { financial_account: 'fa_1', limit: 2 },
      { stripeAccount: 'acct_1' },
    ]);
    expect(calls.get('transfers.retrieve')).toEqual(['obt_1', {}, { stripeAccount: 'acct_1' }]);
    expect(calls.get('payments.retrieve')).toEqual(['obp_1', {}, { stripeAccount: 'acct_1' }]);
    expect(listed).toHaveLength(2);
  });
});
