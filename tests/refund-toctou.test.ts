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
  it('reserves before the provider call so concurrent fulls hit the provider once', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const payment = await seedPayment(storage);

    const full = () => payable.refund({ paymentId: payment.id, amount: Money.of(10_000, 'USD') });
    const results = await Promise.allSettled([full(), full()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(provider.refundCalls).toBe(1);
    const fresh = await storage.payments.findById(payment.id);
    expect(fresh?.refundedAmount).toBe(10_000);
    await db.destroy();
  });

  it('releases the reservation when the provider refund fails', async () => {
    class FailingRefundProvider extends FakeProvider {
      override refund(): Promise<never> {
        return Promise.reject(new Error('provider refund failed'));
      }
    }
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FailingRefundProvider() }, storage });
    const payment = await seedPayment(storage);

    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(10_000, 'USD') }),
    ).rejects.toThrow('provider refund failed');

    const fresh = await storage.payments.findById(payment.id);
    expect(fresh?.refundedAmount).toBe(0);
    expect(fresh?.status).toBe('succeeded');
    const refunds = await storage.refunds.listByPayment(payment.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.status).toBe('failed');
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

  it('scopes refund findById to the owning tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payment = await storage.payments.create({
      tenantId: 'acme',
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_acme',
      status: 'succeeded',
      currency: 'USD',
      amount: 500,
      refundedAmount: 500,
      reference: null,
      description: null,
    });
    const refund = await storage.refunds.create({
      tenantId: 'acme',
      paymentId: payment.id,
      provider: 'stripe',
      providerRefundId: 're_acme',
      status: 'succeeded',
      currency: 'USD',
      amount: 500,
      reason: null,
    });

    expect(await storage.refunds.findById(refund.id, 'globex')).toBeNull();
    expect((await storage.refunds.findById(refund.id, 'acme'))?.id).toBe(refund.id);
    await db.destroy();
  });
});
