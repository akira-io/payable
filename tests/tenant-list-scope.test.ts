import { describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('tenant scoping on list queries (#470)', () => {
  it('scopes payments.listByCustomer by tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    await storage.payments.create({
      tenantId: 'tenant-a',
      customerId: 'cus_shared',
      provider: 'stripe',
      providerPaymentId: 'pi_a',
      status: 'succeeded',
      currency: 'USD',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    expect(await storage.payments.listByCustomer('cus_shared', 'tenant-a')).toHaveLength(1);
    expect(await storage.payments.listByCustomer('cus_shared', 'tenant-b')).toHaveLength(0);
    await db.destroy();
  });

  it('scopes refunds.listByPayment by tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payment = await storage.payments.create({
      tenantId: 'tenant-a',
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_for_refund',
      status: 'succeeded',
      currency: 'USD',
      amount: 1000,
      refundedAmount: 1000,
      reference: null,
      description: null,
    });
    await storage.refunds.create({
      tenantId: 'tenant-a',
      paymentId: payment.id,
      provider: 'stripe',
      providerRefundId: 're_a',
      status: 'succeeded',
      currency: 'USD',
      amount: 1000,
      reason: null,
    });

    expect(await storage.refunds.listByPayment(payment.id, 'tenant-a')).toHaveLength(1);
    expect(await storage.refunds.listByPayment(payment.id, 'tenant-b')).toHaveLength(0);
    await db.destroy();
  });
});
