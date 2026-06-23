import { describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('money bigint coercion', () => {
  it('reads payment money columns back as numbers', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const created = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_bigint',
      status: 'succeeded',
      currency: 'USD',
      amount: 9_007_199_254,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const found = await storage.payments.findById(created.id);
    expect(typeof found?.amount).toBe('number');
    expect(typeof found?.refundedAmount).toBe('number');
    expect(found?.amount).toBe(9_007_199_254);
    await db.destroy();
  });
});
