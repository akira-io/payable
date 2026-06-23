import type { Knex } from 'knex';
import { alterExistingTables } from './alter-existing-tables';
import { createBillingTables } from './billing-schema';
import { runStep } from './migration-ledger';
import { createSystemTables } from './system-schema';

export async function migrate(knex: Knex): Promise<void> {
  await runStep(knex, '001-billing-tables', () => createBillingTables(knex));
  await runStep(knex, '002-system-tables', () => createSystemTables(knex));
  await runStep(knex, '003-alter-existing-tables', () => alterExistingTables(knex));
}
