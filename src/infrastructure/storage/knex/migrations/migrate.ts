import type { Knex } from 'knex';
import { PayableError } from '../../../../domain/errors/payable-error';
import { alterExistingTables } from './alter-existing-tables';
import { createBillingTables } from './billing-schema';
import { runStep } from './migration-ledger';
import { createSystemTables } from './system-schema';
import { addWebhookOccurredAt } from './webhook-occurred-at';
import { widenEndpointSecret } from './widen-endpoint-secret';

const PG_ADVISORY_LOCK_KEY = 4_011_989_001;
const MYSQL_ADVISORY_LOCK_NAME = 'payable_migrations';
const MYSQL_ADVISORY_LOCK_TIMEOUT_SECONDS = 30;

function dialectOf(knex: Knex): string | undefined {
  return (knex.client as { dialect?: string }).dialect;
}

export function readMysqlLockResult(result: unknown): number | null {
  const rows = Array.isArray(result) ? result[0] : result;
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const value = (first as { acquired?: unknown } | undefined)?.acquired;
  return typeof value === 'number' ? value : null;
}

export async function withMigrationLock(knex: Knex, run: () => Promise<void>): Promise<void> {
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
    const result = await knex.raw('SELECT GET_LOCK(?, ?) AS acquired', [
      MYSQL_ADVISORY_LOCK_NAME,
      MYSQL_ADVISORY_LOCK_TIMEOUT_SECONDS,
    ]);
    if (readMysqlLockResult(result) !== 1) {
      throw new PayableError('Could not acquire the MySQL migration advisory lock', {
        code: 'MIGRATION_LOCK_UNAVAILABLE',
        context: { lock: MYSQL_ADVISORY_LOCK_NAME },
      });
    }
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
    await runStep(knex, '004-widen-endpoint-secret', () => widenEndpointSecret(knex));
    await runStep(knex, '005-webhook-occurred-at', () => addWebhookOccurredAt(knex));
  });
}
