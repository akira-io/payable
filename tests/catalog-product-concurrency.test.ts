import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { coordinateNextProductReads } from './support/coordinated-product-storage';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

describe('product mutation concurrency', () => {
  let db: Knex;
  let storage: KnexStorageDriver;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
    storage = new KnexStorageDriver(db, new FakeClock());
    await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Original',
      description: null,
      active: true,
      metadata: null,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  function payableForConcurrentReads() {
    return createPayable({
      providers: { registered: new FakeProvider() },
      storage: coordinateNextProductReads(storage),
    });
  }

  async function expectOneTransition(): Promise<void> {
    expect(await storage.auditLogs.list({ resourceType: 'product' })).toHaveLength(1);
    expect(await db('payable_outbox_events')).toHaveLength(1);
  }

  it('emits one transition when concurrent updates target the same durable state', async () => {
    const payable = payableForConcurrentReads();
    const update = { providerProductId: 'prod_fake', name: 'Concurrent target' };

    await Promise.all([
      payable.products('registered', 'tenant-a').update(update),
      payable.products('registered', 'tenant-a').update(update),
    ]);

    await expectOneTransition();
    expect(
      await storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).toMatchObject({ name: 'Concurrent target' });
  });

  it('rejects the lost divergent update without emitting a stale transition', async () => {
    const payable = payableForConcurrentReads();

    const outcomes = await Promise.allSettled([
      payable
        .products('registered', 'tenant-a')
        .update({ providerProductId: 'prod_fake', name: 'Target A' }),
      payable
        .products('registered', 'tenant-a')
        .update({ providerProductId: 'prod_fake', name: 'Target B' }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    await expectOneTransition();
    const stored = await storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a');
    expect(['Target A', 'Target B']).toContain(stored?.name);
  });
});
