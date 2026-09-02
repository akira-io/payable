import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

describe('refund reference forwarding', () => {
  it('passes refund references to the provider refund input', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_ref',
      status: 'succeeded',
      currency: 'USD',
      amount: 10_000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    const providerData = { refundNote: 'operator-approved' };

    await payable.refund({
      paymentId: payment.id,
      amount: Money.of(4_000, 'USD'),
      reason: 'requested_by_customer',
      reference: 'refund_42',
      providerData,
    });

    expect(provider.lastRefundInput?.reference).toBe('refund_42');
    expect(provider.lastRefundInput?.providerData).toBe(providerData);
    expect(provider.lastRefundCtx?.idempotencyKey).toContain(':refund_42');
    await db.destroy();
  });

  it('passes the resolved local remaining amount when a full refund omits amount', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_full',
      status: 'partially_refunded',
      currency: 'USD',
      amount: 10_000,
      refundedAmount: 2_500,
      reference: null,
      description: null,
    });

    await payable.refund({ paymentId: payment.id });

    expect(provider.lastRefundInput?.amount?.amount()).toBe(7_500);
    expect(provider.lastRefundInput?.amount?.currency()).toBe('USD');
    await db.destroy();
  });
});
