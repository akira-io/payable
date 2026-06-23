import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb, makeCustomer } from './support/knex';

let db: Knex;
let clock: FakeClock;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
});

afterEach(async () => {
  await db.destroy();
});

describe('storage list ordering and batch insert (perf)', () => {
  it('lists rows newest first', async () => {
    const customer = await storage.customers.create(makeCustomer());
    const base = {
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      status: 'succeeded' as const,
      currency: 'USD',
      amount: 100,
      refundedAmount: 0,
      description: null,
    };
    await storage.payments.create({ ...base, providerPaymentId: 'pi_a', reference: 'a' });
    clock.advance(1000);
    await storage.payments.create({ ...base, providerPaymentId: 'pi_b', reference: 'b' });

    const list = await storage.payments.listByCustomer(customer.id);
    expect(list.map((payment) => payment.reference)).toEqual(['b', 'a']);
  });

  it('batch-inserts subscription items in a single call', async () => {
    await storage.subscriptionItems.createMany([
      { subscriptionId: 'sub_x', priceId: 'p1', providerItemId: null, quantity: 1 },
      { subscriptionId: 'sub_x', priceId: 'p2', providerItemId: null, quantity: 2 },
      { subscriptionId: 'sub_x', priceId: 'p3', providerItemId: null, quantity: 3 },
    ]);

    const items = await storage.subscriptionItems.listBySubscription('sub_x');
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.priceId).sort()).toEqual(['p1', 'p2', 'p3']);
  });
});
