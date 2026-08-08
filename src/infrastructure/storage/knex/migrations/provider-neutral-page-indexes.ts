import type { Knex } from 'knex';

const PAYMENT_TABLE = 'payable_payments';
const TENANT_KEY = 'tenant_key';

const PAGE_INDEXES = [
  ['payable_customers', 'payable_customers_tenant_page_index'],
  ['payable_canonical_products', 'payable_canonical_products_page_index'],
  ['payable_canonical_prices', 'payable_canonical_prices_tenant_page_index'],
  ['payable_subscriptions', 'payable_subscriptions_tenant_page_index'],
  ['payable_payments', 'payable_payments_tenant_page_index'],
] as const;

export async function addProviderNeutralPageIndexes(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(PAYMENT_TABLE)) {
    await ensurePaymentTenantKey(knex);
    await backfillPaymentTenantKeys(knex);
    await assertPaymentTenantKeysMatch(knex);
    await ensurePaymentTenantKeyConstraint(knex);
  }

  for (const [table, index] of PAGE_INDEXES) {
    if ((await knex.schema.hasTable(table)) && !(await indexExists(knex, table, index))) {
      await knex.raw('CREATE INDEX ?? ON ?? (??, ??, ??)', [
        index,
        table,
        TENANT_KEY,
        'created_at',
        'id',
      ]);
    }
  }
}

async function ensurePaymentTenantKey(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn(PAYMENT_TABLE, TENANT_KEY)) {
    return;
  }
  await knex.schema.alterTable(PAYMENT_TABLE, (table) => {
    table.string(TENANT_KEY).notNullable().defaultTo('');
  });
}

async function backfillPaymentTenantKeys(knex: Knex): Promise<void> {
  await knex(PAYMENT_TABLE)
    .whereRaw("?? <> COALESCE(??, '')", [TENANT_KEY, 'tenant_id'])
    .update({ [TENANT_KEY]: knex.raw("COALESCE(??, '')", ['tenant_id']) });
}

async function assertPaymentTenantKeysMatch(knex: Knex): Promise<void> {
  const mismatch = await knex(PAYMENT_TABLE)
    .whereRaw("?? <> COALESCE(??, '')", [TENANT_KEY, 'tenant_id'])
    .first('id');
  if (mismatch) {
    throw new Error('payable_payments has tenant_key values that do not match tenant_id');
  }
}

async function ensurePaymentTenantKeyConstraint(knex: Knex): Promise<void> {
  const name = 'payable_payments_tenant_key_consistency_check';
  if (await checkConstraintExists(knex, PAYMENT_TABLE, name)) {
    return;
  }
  await knex.schema.alterTable(PAYMENT_TABLE, (table) => {
    table.check("tenant_key = COALESCE(tenant_id, '')", {}, name);
  });
}

async function checkConstraintExists(
  knex: Knex,
  table: string,
  constraint: string,
): Promise<boolean> {
  const dialect = (knex.client as { dialect?: string }).dialect;
  if (dialect === 'sqlite3' || dialect === 'better-sqlite3') {
    const row = (await knex('sqlite_master').where({ type: 'table', name: table }).first('sql')) as
      | { sql?: string }
      | undefined;
    return row?.sql?.includes(constraint) === true;
  }
  if (dialect === 'postgresql') {
    const result = (await knex.raw(
      "SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = ANY(current_schemas(false)) AND t.relname = ? AND c.conname = ? AND c.contype = 'c') AS present",
      [table, constraint],
    )) as { rows?: { present?: boolean }[] };
    return result.rows?.[0]?.present === true;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    const [rows] = (await knex.raw(
      "SELECT COUNT(*) AS count FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? AND constraint_type = 'CHECK'",
      [table, constraint],
    )) as [{ count?: number | string }[], unknown];
    return Number(rows[0]?.count ?? 0) > 0;
  }
  throw new Error(`Unsupported database dialect for constraint introspection: ${dialect}`);
}

async function indexExists(knex: Knex, table: string, index: string): Promise<boolean> {
  const dialect = (knex.client as { dialect?: string }).dialect;
  if (dialect === 'sqlite3' || dialect === 'better-sqlite3') {
    return Boolean(await knex('sqlite_master').where({ type: 'index', name: index }).first());
  }
  if (dialect === 'postgresql') {
    const result = (await knex.raw(
      'SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = ANY(current_schemas(false)) AND tablename = ? AND indexname = ?) AS present',
      [table, index],
    )) as { rows?: { present?: boolean }[] };
    return result.rows?.[0]?.present === true;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    const [rows] = (await knex.raw(
      'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      [table, index],
    )) as [{ count?: number | string }[], unknown];
    return Number(rows[0]?.count ?? 0) > 0;
  }
  throw new Error(`Unsupported database dialect for page index introspection: ${dialect}`);
}
