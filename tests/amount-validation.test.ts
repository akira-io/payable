import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const storage = new KnexStorageDriver(db, new FakeClock());
  const provider = new FakeProvider();
  const payable = createPayable({ providers: { stripe: provider }, storage });
  return { db, storage, provider, payable };
}

describe('non-positive amount rejection', () => {
  for (const amount of [0, -500]) {
    it(`rejects a charge of ${amount} before touching the provider`, async () => {
      const { db, provider, payable } = await setup();

      await expect(
        payable.customer(billable).charge({ amount: Money.of(amount, 'USD') }),
      ).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_INVALID' });
      expect(provider.chargeCalls).toBe(0);
      await db.destroy();
    });

    it(`rejects a refund of ${amount} before touching the provider`, async () => {
      const { db, storage, provider, payable } = await setup();
      const payment = await storage.payments.create({
        tenantId: null,
        customerId: null,
        provider: 'stripe',
        providerPaymentId: 'pi_amount',
        status: 'succeeded',
        currency: 'USD',
        amount: 10_000,
        refundedAmount: 0,
        reference: null,
        description: null,
      });

      await expect(
        payable.refund({ paymentId: payment.id, amount: Money.of(amount, 'USD') }),
      ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_INVALID' });
      expect(provider.refundCalls).toBe(0);

      const fresh = await storage.payments.findById(payment.id);
      expect(fresh?.refundedAmount).toBe(0);
      expect(fresh?.status).toBe('succeeded');
      await db.destroy();
    });
  }

  it('still allows a positive partial refund', async () => {
    const { db, storage, payable } = await setup();
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_ok',
      status: 'succeeded',
      currency: 'USD',
      amount: 10_000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const refund = await payable.refund({ paymentId: payment.id, amount: Money.of(2500, 'USD') });
    expect(refund.amount).toBe(2500);
    await db.destroy();
  });
});
