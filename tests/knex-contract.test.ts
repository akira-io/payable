import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import {
  CONTRACT_BASE_TIME,
  describeStorageContract,
  type StorageHarness,
} from './support/storage-contract';

describeStorageContract('Knex', async () => {
  let db = createTestDb();
  let clock = new FakeClock(CONTRACT_BASE_TIME);
  const harness: StorageHarness = {
    storage: new KnexStorageDriver(db, clock),
    idempotency: new KnexIdempotencyRepository(db, clock),
    clock,
    async reset() {
      await db.destroy();
      db = createTestDb();
      await migrate(db);
      clock = new FakeClock(CONTRACT_BASE_TIME);
      harness.storage = new KnexStorageDriver(db, clock);
      harness.idempotency = new KnexIdempotencyRepository(db, clock);
      harness.clock = clock;
    },
    async teardown() {
      await db.destroy();
    },
  };
  return harness;
});
