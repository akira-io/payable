import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

let db: Knex;
let clock: FakeClock;
let storage: KnexStorageDriver;
let provider: FakeProvider;
let payable: Payable;

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
  provider = new FakeProvider();
  payable = createPayable({ providers: { stripe: provider }, storage, clock });
});

afterEach(async () => {
  await db.destroy();
});

describe('webhook payment reconciliation (C1)', () => {
  it('updates a local payment status from a provider event', async () => {
    const session = await payable
      .customer(billable)
      .redirectCheckout(Money.of(9900, 'USD'))
      .create({ reference: 'order-1' });
    provider.verifyResult = {
      providerEventId: 'evt_payment',
      type: 'ORDER_COMPLETED',
      normalizedType: 'payment.succeeded',
      data: {},
    };
    provider.paymentReconcileResult = {
      providerPaymentId: session.id,
      status: 'succeeded',
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.payments.findByProviderId('stripe', session.id);
    expect(reloaded?.status).toBe('succeeded');
  });

  it('recovers a failed payment when a verified retry later succeeds', async () => {
    const session = await payable
      .customer(billable)
      .redirectCheckout(Money.of(9900, 'USD'))
      .create({ reference: 'order-retry' });
    provider.verifyResult = {
      providerEventId: 'evt_failed',
      type: 'ORDER_FAILED',
      normalizedType: 'payment.failed',
      occurredAt: new Date('2026-06-22T10:00:00.000Z'),
      data: {},
    };
    provider.paymentReconcileResult = { providerPaymentId: session.id, status: 'failed' };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    expect((await storage.payments.findByProviderId('stripe', session.id))?.status).toBe('failed');

    provider.verifyResult = {
      providerEventId: 'evt_recovered',
      type: 'ORDER_COMPLETED',
      normalizedType: 'payment.succeeded',
      occurredAt: new Date('2026-06-22T11:00:00.000Z'),
      data: {},
    };
    provider.paymentReconcileResult = { providerPaymentId: session.id, status: 'succeeded' };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.payments.findByProviderId('stripe', session.id);
    expect(reloaded?.status).toBe('succeeded');
  });

  it('keeps a succeeded payment when a stale failure event arrives afterwards', async () => {
    const session = await payable
      .customer(billable)
      .redirectCheckout(Money.of(9900, 'USD'))
      .create({ reference: 'order-reverse' });
    provider.verifyResult = {
      providerEventId: 'evt_success_first',
      type: 'ORDER_COMPLETED',
      normalizedType: 'payment.succeeded',
      occurredAt: new Date('2026-06-22T11:00:00.000Z'),
      data: {},
    };
    provider.paymentReconcileResult = { providerPaymentId: session.id, status: 'succeeded' };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    provider.verifyResult = {
      providerEventId: 'evt_failed_late',
      type: 'ORDER_FAILED',
      normalizedType: 'payment.failed',
      occurredAt: new Date('2026-06-22T10:00:00.000Z'),
      data: {},
    };
    provider.paymentReconcileResult = { providerPaymentId: session.id, status: 'failed' };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.payments.findByProviderId('stripe', session.id);
    expect(reloaded?.status).toBe('succeeded');
  });

  it('ignores a stale payment webhook that cannot transition the local status', async () => {
    const payment = await payable
      .customer(billable)
      .charge({ amount: Money.of(9900, 'USD'), reference: 'order-final' });
    provider.verifyResult = {
      providerEventId: 'evt_payment_stale',
      type: 'ORDER_FAILED',
      normalizedType: 'payment.failed',
      data: {},
    };
    provider.paymentReconcileResult = {
      providerPaymentId: payment.providerPaymentId ?? '',
      status: 'failed',
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.payments.findByProviderId(
      'stripe',
      payment.providerPaymentId ?? '',
    );
    expect(reloaded?.status).toBe('succeeded');
  });
});
