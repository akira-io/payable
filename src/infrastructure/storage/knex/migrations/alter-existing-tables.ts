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
    {
      name: 'claimed_until',
      apply: (table) => table.timestamp('claimed_until', { useTz: true }).nullable(),
    },
  ]);
  await ensureColumns(knex, 'payable_idempotency_keys', [
    { name: 'lock_token', apply: (table) => table.string('lock_token').nullable() },
  ]);
  await ensureColumns(knex, 'payable_audit_logs', [
    { name: 'previous_hash', apply: (table) => table.string('previous_hash').nullable() },
    { name: 'hash', apply: (table) => table.string('hash').nullable() },
    { name: 'sequence', apply: (table) => table.integer('sequence').nullable() },
  ]);
  await ensureColumns(knex, 'payable_webhook_deliveries', [
    { name: 'event_id', apply: (table) => table.uuid('event_id').nullable() },
  ]);
  await ensureIndexes(knex, [
    {
      table: 'payable_webhook_deliveries',
      name: 'payable_webhook_deliveries_endpoint_event_index',
      columns: ['endpoint_id', 'event_id'],
    },
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
      name: 'payable_outbox_events_pending_claim_index',
      columns: ['status', 'next_retry_at', 'created_at', 'id'],
    },
    {
      table: 'payable_outbox_events',
      name: 'payable_outbox_events_stale_claim_index',
      columns: ['status', 'locked_until', 'created_at', 'id'],
    },
  ]);
  await ensureCustomerBillableUnique(knex);
}

const CUSTOMER_BILLABLE_INDEX = 'payable_customers_tenant_billable_unique';
const CUSTOMER_TENANT_KEY = 'tenant_key';

async function ensureCustomerBillableUnique(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('payable_customers'))) {
    return;
  }
  const dialect = (knex.client as { dialect?: string }).dialect;
  if (dialect === 'mysql' || dialect === 'mariadb') {
    await ensureMysqlCustomerBillableUnique(knex);
    return;
  }
  await knex.raw("CREATE UNIQUE INDEX IF NOT EXISTS ?? ON ?? (COALESCE(??, ''), ??, ??)", [
    CUSTOMER_BILLABLE_INDEX,
    'payable_customers',
    'tenant_id',
    'billable_type',
    'billable_id',
  ]);
}

async function ensureMysqlCustomerBillableUnique(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('payable_customers', CUSTOMER_TENANT_KEY))) {
    await knex.raw("ALTER TABLE ?? ADD COLUMN ?? VARCHAR(255) AS (COALESCE(??, '')) STORED", [
      'payable_customers',
      CUSTOMER_TENANT_KEY,
      'tenant_id',
    ]);
  }
  const [rows] = (await knex.raw(
    'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    ['payable_customers', CUSTOMER_BILLABLE_INDEX],
  )) as [{ count: number }[], unknown];
  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }
  await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??, ??, ??)', [
    CUSTOMER_BILLABLE_INDEX,
    'payable_customers',
    CUSTOMER_TENANT_KEY,
    'billable_type',
    'billable_id',
  ]);
}

interface IndexSpec {
  table: string;
  name: string;
  columns: string[];
}

async function ensureIndexes(knex: Knex, specs: IndexSpec[]): Promise<void> {
  const dialect = (knex.client as { dialect?: string }).dialect;
  const isMysql = dialect === 'mysql' || dialect === 'mariadb';
  for (const spec of specs) {
    if (!(await knex.schema.hasTable(spec.table))) {
      continue;
    }
    if (isMysql && (await mysqlIndexExists(knex, spec.table, spec.name))) {
      continue;
    }
    const placeholders = spec.columns.map(() => '??').join(', ');
    const ifNotExists = isMysql ? '' : 'IF NOT EXISTS ';
    await knex.raw(`CREATE INDEX ${ifNotExists}?? ON ?? (${placeholders})`, [
      spec.name,
      spec.table,
      ...spec.columns,
    ]);
  }
}

async function mysqlIndexExists(knex: Knex, table: string, name: string): Promise<boolean> {
  const [rows] = (await knex.raw(
    'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    [table, name],
  )) as [{ count: number }[], unknown];
  return Number(rows[0]?.count ?? 0) > 0;
}
