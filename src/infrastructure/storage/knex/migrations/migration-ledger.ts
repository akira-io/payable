import type { Knex } from 'knex';

const LEDGER_TABLE = 'payable_migrations';

async function ensureLedger(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(LEDGER_TABLE)) {
    return;
  }
  await knex.schema.createTable(LEDGER_TABLE, (table) => {
    table.string('name').primary();
    table.timestamp('applied_at').notNullable();
  });
}

export async function runStep(knex: Knex, name: string, step: () => Promise<void>): Promise<void> {
  await ensureLedger(knex);
  const applied = await knex(LEDGER_TABLE).where({ name }).first();
  if (applied) {
    return;
  }
  await step();
  await knex(LEDGER_TABLE).insert({ name, applied_at: new Date().toISOString() });
}

export async function appliedMigrations(knex: Knex): Promise<string[]> {
  await ensureLedger(knex);
  const rows = (await knex(LEDGER_TABLE).select('name').orderBy('name', 'asc')) as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}
