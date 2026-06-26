import type { Knex } from 'knex';
import { alterExistingTables } from './alter-existing-tables';
import { createBillingTables } from './billing-schema';
import { runStep } from './migration-ledger';
import { createSystemTables } from './system-schema';

const PG_ADVISORY_LOCK_KEY = 4_011_989_001;
const MYSQL_ADVISORY_LOCK_NAME = 'payable_migrations';
const MYSQL_ADVISORY_LOCK_TIMEOUT_SECONDS = 30;

function dialectOf(knex: Knex): string | undefined {
  return (knex.client as { dialect?: string }).dialect;
}

async function withMigrationLock(knex: Knex, run: () => Promise<void>): Promise<void> {
  const dialect = dialectOf(knex);
  if (dialect === 'postgresql') {
    await knex.raw('SELECT pg_advisory_lock(?)', [PG_ADVISORY_LOCK_KEY]);
    try {
      await run();
    } finally {
      await knex.raw('SELECT pg_advisory_unlock(?)', [PG_ADVISORY_LOCK_KEY]);
    }
    return;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    await knex.raw('SELECT GET_LOCK(?, ?)', [
      MYSQL_ADVISORY_LOCK_NAME,
      MYSQL_ADVISORY_LOCK_TIMEOUT_SECONDS,
    ]);
    try {
      await run();
    } finally {
      await knex.raw('SELECT RELEASE_LOCK(?)', [MYSQL_ADVISORY_LOCK_NAME]);
    }
    return;
  }
  await run();
}

export async function migrate(knex: Knex): Promise<void> {
  await withMigrationLock(knex, async () => {
    await runStep(knex, '001-billing-tables', () => createBillingTables(knex));
    await runStep(knex, '002-system-tables', () => createSystemTables(knex));
    await runStep(knex, '003-alter-existing-tables', () => alterExistingTables(knex));
  });
}
