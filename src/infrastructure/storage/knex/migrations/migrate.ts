import type { Knex } from 'knex';
import { alterExistingTables } from './alter-existing-tables';
import { createBillingTables } from './billing-schema';
import { createSystemTables } from './system-schema';

export async function migrate(knex: Knex): Promise<void> {
  await createBillingTables(knex);
  await createSystemTables(knex);
  await alterExistingTables(knex);
}
