import type { Knex } from 'knex';
import { createBillingTables } from './billing-schema';
import { createSystemTables } from './system-schema';

export async function migrate(knex: Knex): Promise<void> {
  await createBillingTables(knex);
  await createSystemTables(knex);
}
