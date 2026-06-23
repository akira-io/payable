import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

async function seedPayment(storage: KnexStorageDriver) {
  return storage.payments.create({
    tenantId: null,
    customerId: null,
    provider: 'stripe',
    providerPaymentId: 'pi_toctou',
    status: 'succeeded',
    currency: 'USD',
    amount: 10_000,
    refundedAmount: 0,
    reference: null,
    description: null,
  });
}

describe('refund TOCTOU guard', () => {
  it('re-validates the remaining balance inside the transaction', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const payment = await seedPayment(storage);

    const full = () => payable.refund({ paymentId: payment.id, amount: Money.of(10_000, 'USD') });
    const results = await Promise.allSettled([full(), full()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const fresh = await storage.payments.findById(payment.id);
    expect(fresh?.refundedAmount).toBe(10_000);
    await db.destroy();
  });

  it('locks the payment row for update', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payment = await seedPayment(storage);

    await storage.transaction(async (repos) => {
      const locked = await repos.payments.findByIdForUpdate(payment.id);
      expect(locked?.id).toBe(payment.id);
    });
    await db.destroy();
  });
});
