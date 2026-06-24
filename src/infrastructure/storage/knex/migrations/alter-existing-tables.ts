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
  await ensureColumns(knex, 'payable_audit_logs', [
    { name: 'previous_hash', apply: (table) => table.string('previous_hash').nullable() },
    { name: 'hash', apply: (table) => table.string('hash').nullable() },
    { name: 'sequence', apply: (table) => table.integer('sequence').nullable() },
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
  if (await knex.schema.hasTable('payable_customers')) {
    await knex.raw("CREATE UNIQUE INDEX IF NOT EXISTS ?? ON ?? (COALESCE(??, ''), ??, ??)", [
      'payable_customers_tenant_billable_unique',
      'payable_customers',
      'tenant_id',
      'billable_type',
      'billable_id',
    ]);
  }
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
