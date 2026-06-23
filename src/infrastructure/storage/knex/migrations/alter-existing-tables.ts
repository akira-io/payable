import type { Knex } from 'knex';

interface ColumnSpec {
  name: string;
  apply: (table: Knex.AlterTableBuilder) => void;
}

async function ensureColumns(knex: Knex, table: string, columns: ColumnSpec[]): Promise<void> {
  if (!(await knex.schema.hasTable(table))) {
    return;
  }
  for (const column of columns) {
    if (await knex.schema.hasColumn(table, column.name)) {
      continue;
    }
    await knex.schema.alterTable(table, (builder) => column.apply(builder));
  }
}

export async function alterExistingTables(knex: Knex): Promise<void> {
  await ensureColumns(knex, 'payable_webhook_events', [
    { name: 'normalized_type', apply: (table) => table.string('normalized_type').nullable() },
    { name: 'data', apply: (table) => table.text('data').notNullable().defaultTo('{}') },
  ]);
}
