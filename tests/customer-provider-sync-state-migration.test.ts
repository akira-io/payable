import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { appliedMigrations } from '../src/infrastructure/storage/knex/migrations/migration-ledger';
import { createTestDb } from './support/knex';

describe('customer provider sync state migration', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('adds lease ownership columns after migration 012 was already recorded', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    await database.schema.alterTable('payable_customer_provider_sync_states', (table) => {
      table.dropColumn('attempt_owner_id');
      table.dropColumn('lease_expires_at');
    });
    await database('payable_migrations')
      .where({ name: '013-customer-provider-sync-state-leases' })
      .delete();
    expect(await appliedMigrations(database)).toContain('012-customer-provider-sync-states');
    expect(
      await database.schema.hasColumn('payable_customer_provider_sync_states', 'attempt_owner_id'),
    ).toBe(false);

    await migrate(database);

    expect(
      await database.schema.hasColumn('payable_customer_provider_sync_states', 'attempt_owner_id'),
    ).toBe(true);
    expect(
      await database.schema.hasColumn('payable_customer_provider_sync_states', 'lease_expires_at'),
    ).toBe(true);
    expect(await appliedMigrations(database)).toContain('013-customer-provider-sync-state-leases');
  });
});
