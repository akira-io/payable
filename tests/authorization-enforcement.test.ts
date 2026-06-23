import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };
const authorized = { allowed: true, actorId: 'admin' };

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  const storage = new KnexStorageDriver(db, clock);
  const payable = createPayable({
    providers: { stripe: new FakeProvider() },
    storage,
    clock,
    authorization: { enabled: true },
  });
  return { db, payable };
}

describe('authorization enforcement', () => {
  it('rejects a refund without an authorized context', async () => {
    const { db, payable } = await setup();
    const payment = await payable.customer(billable).charge({ amount: Money.of(1000, 'USD') });

    await expect(
      payable.refund({ paymentId: payment.id, amount: Money.of(1000, 'USD') }),
    ).rejects.toThrow('Not authorized');

    const refund = await payable.refund({
      paymentId: payment.id,
      amount: Money.of(1000, 'USD'),
      authorization: authorized,
    });
    expect(refund.amount).toBe(1000);
    await db.destroy();
  });

  it('rejects a subscription cancel without an authorized context', async () => {
    const { db, payable } = await setup();
    await payable.customer(billable).newSubscription('default').price('price_1').create(authorized);

    await expect(payable.customer(billable).subscription('default').cancel()).rejects.toThrow(
      'Not authorized',
    );

    const canceled = await payable.customer(billable).subscription('default').cancel(authorized);
    expect(canceled.status).toBeDefined();
    await db.destroy();
  });

  it('does not enforce when authorization is disabled', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });

    const payment = await payable.customer(billable).charge({ amount: Money.of(1000, 'USD') });
    const refund = await payable.refund({ paymentId: payment.id, amount: Money.of(1000, 'USD') });
    expect(refund.amount).toBe(1000);
    await db.destroy();
  });
});
