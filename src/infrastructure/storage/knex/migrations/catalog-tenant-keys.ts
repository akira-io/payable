import type { Knex } from 'knex';

interface CatalogTenantKeySpec {
  table: 'payable_products' | 'payable_prices';
  providerIdColumn: 'provider_product_id' | 'provider_price_id';
  legacyIndex: string;
  normalizedIndex: string;
  consistencyConstraint: string;
}

const BATCH_SIZE = 100;
const TENANT_KEY = 'tenant_key';
const CATALOG_SPECS: CatalogTenantKeySpec[] = [
  {
    table: 'payable_products',
    providerIdColumn: 'provider_product_id',
    legacyIndex: 'payable_products_provider_provider_product_id_unique',
    normalizedIndex: 'payable_products_tenant_provider_product_unique',
    consistencyConstraint: 'payable_products_tenant_key_consistency_check',
  },
  {
    table: 'payable_prices',
    providerIdColumn: 'provider_price_id',
    legacyIndex: 'payable_prices_provider_provider_price_id_unique',
    normalizedIndex: 'payable_prices_tenant_provider_price_unique',
    consistencyConstraint: 'payable_prices_tenant_key_consistency_check',
  },
];

export async function addCatalogTenantKeys(knex: Knex): Promise<void> {
  for (const spec of CATALOG_SPECS) {
    if (!(await knex.schema.hasTable(spec.table))) {
      continue;
    }
    await ensureTenantKey(knex, spec.table);
    await backfillTenantKeys(knex, spec.table);
    await assertTenantKeysMatch(knex, spec.table);
    await ensureTenantKeyConstraint(knex, spec);
    await assertNoDuplicateCatalogIdentities(knex, spec);
    await ensureNormalizedIndex(knex, spec);
    await dropLegacyIndex(knex, spec);
  }
}

async function ensureTenantKey(knex: Knex, table: string): Promise<void> {
  if (await knex.schema.hasColumn(table, TENANT_KEY)) {
    return;
  }
  await knex.schema.alterTable(table, (builder) => {
    builder.string(TENANT_KEY).notNullable().defaultTo('');
  });
}

async function backfillTenantKeys(knex: Knex, table: string): Promise<void> {
  while (true) {
    const rows = (await knex(table)
      .select('id')
      .whereRaw("?? <> COALESCE(??, '')", [TENANT_KEY, 'tenant_id'])
      .orderBy('id')
      .limit(BATCH_SIZE)) as { id: string }[];
    if (rows.length === 0) {
      return;
    }
    await knex(table)
      .whereIn(
        'id',
        rows.map((row) => row.id),
      )
      .update({ [TENANT_KEY]: knex.raw("COALESCE(??, '')", ['tenant_id']) });
  }
}

async function assertTenantKeysMatch(knex: Knex, table: string): Promise<void> {
  const mismatch = await knex(table)
    .whereRaw("?? <> COALESCE(??, '')", [TENANT_KEY, 'tenant_id'])
    .first('id');
  if (mismatch) {
    throw new Error(`${table} has tenant_key values that do not match tenant_id`);
  }
}

async function ensureTenantKeyConstraint(knex: Knex, spec: CatalogTenantKeySpec): Promise<void> {
  if (await checkConstraintExists(knex, spec.table, spec.consistencyConstraint)) {
    return;
  }
  await knex.schema.alterTable(spec.table, (table) => {
    table.check("tenant_key = COALESCE(tenant_id, '')", {}, spec.consistencyConstraint);
  });
}

async function assertNoDuplicateCatalogIdentities(
  knex: Knex,
  spec: CatalogTenantKeySpec,
): Promise<void> {
  const duplicates = (await knex(spec.table)
    .select(TENANT_KEY, 'provider', knex.raw('?? AS provider_id', [spec.providerIdColumn]))
    .whereNotNull(spec.providerIdColumn)
    .count({ count: '*' })
    .groupBy(TENANT_KEY, 'provider', spec.providerIdColumn)
    .havingRaw('COUNT(*) > 1')) as {
    tenant_key: string;
    provider: string;
    provider_id: string;
  }[];
  if (duplicates.length === 0) {
    return;
  }
  const identities = duplicates
    .map(
      (duplicate) =>
        `(${duplicate.tenant_key || 'null'}, ${duplicate.provider}, ${duplicate.provider_id})`,
    )
    .join(', ');
  throw new Error(`${spec.table} has duplicate normalized provider identities: ${identities}`);
}

async function ensureNormalizedIndex(knex: Knex, spec: CatalogTenantKeySpec): Promise<void> {
  if (await indexExists(knex, spec.table, spec.normalizedIndex)) {
    return;
  }
  await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??, ??, ??)', [
    spec.normalizedIndex,
    spec.table,
    TENANT_KEY,
    'provider',
    spec.providerIdColumn,
  ]);
}

async function dropLegacyIndex(knex: Knex, spec: CatalogTenantKeySpec): Promise<void> {
  if (!(await indexExists(knex, spec.table, spec.legacyIndex))) {
    return;
  }
  const dialect = dialectOf(knex);
  if (dialect === 'mysql' || dialect === 'mariadb') {
    await knex.raw('DROP INDEX ?? ON ??', [spec.legacyIndex, spec.table]);
    return;
  }
  await knex.raw('DROP INDEX ??', [spec.legacyIndex]);
}

async function indexExists(knex: Knex, table: string, index: string): Promise<boolean> {
  const dialect = dialectOf(knex);
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
  throw new Error(`Unsupported database dialect for catalog index introspection: ${dialect}`);
}

async function checkConstraintExists(
  knex: Knex,
  table: string,
  constraint: string,
): Promise<boolean> {
  const dialect = dialectOf(knex);
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
  throw new Error(`Unsupported database dialect for catalog constraint introspection: ${dialect}`);
}

function dialectOf(knex: Knex): string | undefined {
  return (knex.client as { dialect?: string }).dialect;
}
