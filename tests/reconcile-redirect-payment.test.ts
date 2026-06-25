import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import {
  SispProvider,
  type SispProviderOptions,
} from '../src/infrastructure/providers/sisp/sisp-provider';
import type { SispClient } from '../src/infrastructure/providers/sisp/sisp-types';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

const OPTIONS: SispProviderOptions = {
  posId: '90000045',
  posAutCode: 'aut-code',
  database: { client: 'better-sqlite3', connection: { filename: ':memory:' } },
};

interface CallbackState {
  valid: boolean;
  status: string;
}

function fakeSispClient(state: CallbackState): SispClient {
  return {
    config: { generators: { merchantReference: () => 'R-CHECKOUT' } },
    handlers: {
      handlePayment: async (request) => ({
        type: 'html',
        status: 200,
        html: `<form>${request.body.merchantRef}</form>`,
      }),
    },
    driver: () => ({ paymentEndpoint: () => 'https://mc.vinti4net.cv/gateway' }),
    models: { transactions: { findByRef: async () => null } },
    refund: () => {
      throw new Error('not used');
    },
    validateCallback: () => state.valid,
    handlePaymentCallback: async (payload) => ({
      id: 1,
      merchant_ref: String(payload.merchantRef ?? 'R-CHECKOUT'),
      amount: 1500,
      currency: 'CVE',
      status: state.status,
      transaction_id: 'TID-9',
    }),
  };
}

describe('reconcile redirect payment', () => {
  let state: CallbackState;

  async function setup() {
    const db = createTestDb();
    await migrate(db);
    state = { valid: true, status: 'completed' };
    const payable = createPayable({
      providers: { sisp: new SispProvider(OPTIONS, fakeSispClient(state)) },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    await payable.customer(billable).redirectCheckout(Money.of(150000, 'CVE')).create({
      reference: 'order-1',
    });
    return { db, payable };
  }

  it('rejects a callback that fails verification', async () => {
    const { db, payable } = await setup();
    state.valid = false;
    await expect(
      payable.receiveRedirectCallback({ provider: 'sisp', payload: { merchantRef: 'R-CHECKOUT' } }),
    ).rejects.toMatchObject({ code: 'REDIRECT_CALLBACK_INVALID' });
    const [payment] = await payable.customer(billable).payments();
    expect(payment?.status).toBe('pending');
    await db.destroy();
  });

  it('is idempotent across duplicate callbacks', async () => {
    const { db, payable } = await setup();
    const first = await payable.receiveRedirectCallback({
      provider: 'sisp',
      payload: { merchantRef: 'R-CHECKOUT' },
    });
    expect(first.paymentUpdated).toBe(true);
    const second = await payable.receiveRedirectCallback({
      provider: 'sisp',
      payload: { merchantRef: 'R-CHECKOUT' },
    });
    expect(second.paymentUpdated).toBe(false);

    const [payment] = await payable.customer(billable).payments();
    expect(payment?.status).toBe('succeeded');
    const logs = await payable
      .auditLogs()
      .run({ resourceType: 'payment', resourceId: payment?.id });
    expect(logs.filter((log) => log.action === 'payment.reconciled')).toHaveLength(1);
    await db.destroy();
  });

  it('does not move a succeeded payment backward on a late failed callback', async () => {
    const { db, payable } = await setup();
    await payable.receiveRedirectCallback({
      provider: 'sisp',
      payload: { merchantRef: 'R-CHECKOUT' },
    });
    state.status = 'failed';
    const late = await payable.receiveRedirectCallback({
      provider: 'sisp',
      payload: { merchantRef: 'R-CHECKOUT' },
    });
    expect(late.paymentUpdated).toBe(false);
    const [payment] = await payable.customer(billable).payments();
    expect(payment?.status).toBe('succeeded');
    await db.destroy();
  });

  it('writes an audit log when the status advances', async () => {
    const { db, payable } = await setup();
    await payable.receiveRedirectCallback({
      provider: 'sisp',
      payload: { merchantRef: 'R-CHECKOUT' },
    });
    const [payment] = await payable.customer(billable).payments();
    const logs = await payable
      .auditLogs()
      .run({ resourceType: 'payment', resourceId: payment?.id });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'payment.reconciled',
      resourceType: 'payment',
      before: { status: 'pending' },
      after: { status: 'succeeded' },
    });
    await db.destroy();
  });
});
