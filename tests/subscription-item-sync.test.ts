import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;
let payable: Payable;

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
  payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });
});

afterEach(async () => {
  await db.destroy();
});

describe('subscription item sync (I2)', () => {
  it('re-syncs the primary item on swap and quantity change', async () => {
    const subscription = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .create();

    const initial = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(initial).toHaveLength(1);
    expect(initial[0]?.priceId).toBe('price_pro');

    await payable.customer(billable).subscription('default').swap('price_business');
    const afterSwap = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(afterSwap[0]?.priceId).toBe('price_business');

    await payable.customer(billable).subscription('default').updateQuantity(4);
    const afterQuantity = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(afterQuantity[0]?.quantity).toBe(4);
    expect(afterQuantity[0]?.priceId).toBe('price_business');
  });
});
