import { describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import {
  appliedMigrations,
  runStep,
} from '../src/infrastructure/storage/knex/migrations/migration-ledger';
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
      '004-widen-endpoint-secret',
      '005-webhook-occurred-at',
      '006-subscription-provider-synced-at',
    ]);
    await db.destroy();
  });

  it('converges instead of crashing when a concurrent migrator inserts the ledger row first', async () => {
    const db = createTestDb();
    await migrate(db);

    let ran = 0;
    await expect(
      runStep(db, 'concurrent-step', async () => {
        ran += 1;
        await db('payable_migrations').insert({
          name: 'concurrent-step',
          applied_at: new Date().toISOString(),
        });
      }),
    ).resolves.toBeUndefined();

    expect(ran).toBe(1);
    expect((await appliedMigrations(db)).filter((name) => name === 'concurrent-step')).toHaveLength(
      1,
    );
    await db.destroy();
  });
});
