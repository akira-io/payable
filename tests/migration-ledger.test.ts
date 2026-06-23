import { describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { appliedMigrations } from '../src/infrastructure/storage/knex/migrations/migration-ledger';
import { createTestDb } from './support/knex';

describe('migration ledger', () => {
  it('records each migration step once and is idempotent', async () => {
    const db = createTestDb();
    await migrate(db);
    await migrate(db);

    expect(await appliedMigrations(db)).toEqual([
      '001-billing-tables',
      '002-system-tables',
      '003-alter-existing-tables',
    ]);
    await db.destroy();
  });
});
