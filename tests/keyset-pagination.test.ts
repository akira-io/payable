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

describe('keyset pagination', () => {
  it('pages backwards through a customer list with a cursor', async () => {
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
    for (const reference of ['a', 'b', 'c']) {
      await storage.payments.create({ ...base, providerPaymentId: `pi_${reference}`, reference });
      clock.advance(1000);
    }

    const page1 = await storage.payments.listByCustomer(customer.id, { limit: 2 });
    expect(page1.map((p) => p.reference)).toEqual(['c', 'b']);

    const last = page1[1];
    const page2 = await storage.payments.listByCustomer(customer.id, {
      limit: 2,
      before: { createdAt: last?.createdAt as Date, id: last?.id as string },
    });
    expect(page2.map((p) => p.reference)).toEqual(['a']);
  });
});
