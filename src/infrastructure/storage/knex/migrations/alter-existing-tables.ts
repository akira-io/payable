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
  await ensureColumns(knex, 'payable_idempotency_keys', [
    { name: 'lock_token', apply: (table) => table.string('lock_token').nullable() },
  ]);
  await ensureIndexes(knex, [
    {
      table: 'payable_subscriptions',
      name: 'payable_subscriptions_customer_created_id_index',
      columns: ['customer_id', 'created_at', 'id'],
    },
    {
      table: 'payable_invoices',
      name: 'payable_invoices_customer_created_id_index',
      columns: ['customer_id', 'created_at', 'id'],
    },
    {
      table: 'payable_payments',
      name: 'payable_payments_customer_created_id_index',
      columns: ['customer_id', 'created_at', 'id'],
    },
    {
      table: 'payable_refunds',
      name: 'payable_refunds_payment_created_id_index',
      columns: ['payment_id', 'created_at', 'id'],
    },
    {
      table: 'payable_outbox_events',
      name: 'payable_outbox_events_status_locked_index',
      columns: ['status', 'locked_until'],
    },
  ]);
}

interface IndexSpec {
  table: string;
  name: string;
  columns: string[];
}

async function ensureIndexes(knex: Knex, specs: IndexSpec[]): Promise<void> {
  for (const spec of specs) {
    if (!(await knex.schema.hasTable(spec.table))) {
      continue;
    }
    const placeholders = spec.columns.map(() => '??').join(', ');
    await knex.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? (${placeholders})`, [
      spec.name,
      spec.table,
      ...spec.columns,
    ]);
  }
}
