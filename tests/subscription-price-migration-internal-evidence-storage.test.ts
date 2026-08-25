import { describe, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma/prisma-storage.driver';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';
import { assertInternalEvidenceForStorage } from './support/subscription-price-migration-evidence-contract';
import { STORAGE_TIME } from './support/subscription-price-migration-storage-contract';

describe('subscription price migration internal execution evidence storage', () => {
  it('persists atomically and tenant-safely with Knex', async () => {
    const database = createTestDb();
    try {
      await migrate(database);
      const storage = new KnexStorageDriver(database, new FakeClock(STORAGE_TIME));
      await assertInternalEvidenceForStorage(storage, 'migration-tenant', 'knex-evidence');
    } finally {
      await database.destroy();
    }
  });

  it('persists atomically and tenant-safely with Prisma', async () => {
    const client: PrismaClientLike = await createPrismaTestClient();
    try {
      const storage = new PrismaStorageDriver(client, new FakeClock(STORAGE_TIME));
      await assertInternalEvidenceForStorage(
        storage,
        'migration-prisma-evidence-tenant',
        'prisma-evidence',
      );
    } finally {
      await disconnectPrisma(client);
    }
  });
});
