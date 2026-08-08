import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

const TABLE = 'payable_subscriptions';
const BINDINGS_TABLE = 'payable_subscription_provider_bindings';
const BACKFILL_BATCH_SIZE = 500;

export async function addCanonicalLocalSubscriptions(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(TABLE))) return;

  const columns = await knex(TABLE).columnInfo();
  await knex.schema.alterTable(TABLE, (table) => {
    if (!columns.tenant_key) table.string('tenant_key').notNullable().defaultTo('');
    if (!columns.canonical_price_id) table.uuid('canonical_price_id').nullable();
    if (!columns.accepted_currency) table.string('accepted_currency').nullable();
    if (!columns.accepted_unit_amount) table.bigInteger('accepted_unit_amount').nullable();
    if (!columns.accepted_interval) table.string('accepted_interval').nullable();
    if (!columns.accepted_interval_count) table.integer('accepted_interval_count').nullable();
    if (!columns.accepted_quantity) table.integer('accepted_quantity').nullable();
    if (!columns.collection_responsibility)
      table.string('collection_responsibility').notNullable().defaultTo('provider');
    if (!columns.creation_source) table.string('creation_source').nullable();
  });

  await knex(TABLE)
    .whereRaw("tenant_key <> COALESCE(tenant_id, '')")
    .update({
      tenant_key: knex.raw("COALESCE(tenant_id, '')"),
    });
  if (await knex(TABLE).whereRaw("tenant_key <> COALESCE(tenant_id, '')").first('id')) {
    throw new Error(`${TABLE} has tenant_key values that do not match tenant_id`);
  }

  if (columns.provider && columns.provider.nullable === false) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.string('provider').nullable().alter();
    });
  }

  await ensureSubscriptionConsistencyCheck(knex);
  await assertNoDuplicateIdentity(knex, ['tenant_key', 'customer_id', 'name'], 'logical');
  await assertNoDuplicateIdentity(
    knex,
    ['tenant_key', 'provider', 'provider_subscription_id'],
    'provider',
    'provider_subscription_id',
  );
  await ensureUniqueIndex(knex, TABLE, 'payable_subscriptions_tenant_customer_name_unique', [
    'tenant_key',
    'customer_id',
    'name',
  ]);
  await ensureUniqueIndex(knex, TABLE, 'payable_subscriptions_tenant_provider_id_unique', [
    'tenant_key',
    'provider',
    'provider_subscription_id',
  ]);
  await dropLegacyUniqueIdentity(knex, 'payable_subscriptions_customer_id_name_unique');
  await dropLegacyUniqueIdentity(
    knex,
    'payable_subscriptions_provider_provider_subscription_id_unique',
  );

  await createIfMissing(knex, BINDINGS_TABLE, (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('subscription_id').notNullable().references('id').inTable(TABLE).onDelete('CASCADE');
    table.string('provider').notNullable();
    table.string('provider_subscription_id').notNullable();
    table.timestamp('provider_synced_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.check(
      "tenant_key = COALESCE(tenant_id, '')",
      {},
      'payable_subscription_bindings_tenant_key_consistency_check',
    );
    table.unique(['tenant_key', 'subscription_id', 'provider'], {
      indexName: 'payable_subscription_bindings_subscription_provider_unique',
    });
    table.unique(['tenant_key', 'provider', 'provider_subscription_id'], {
      indexName: 'payable_subscription_bindings_provider_id_unique',
    });
  });
  await ensureBindingConsistencyCheck(knex);
  await ensureUniqueIndex(
    knex,
    BINDINGS_TABLE,
    'payable_subscription_bindings_subscription_provider_unique',
    ['tenant_key', 'subscription_id', 'provider'],
  );
  await ensureUniqueIndex(
    knex,
    BINDINGS_TABLE,
    'payable_subscription_bindings_provider_id_unique',
    ['tenant_key', 'provider', 'provider_subscription_id'],
  );
  await backfillLegacyProviderBindings(knex);
  await assertNoMissingLegacyProviderBinding(knex);
}

interface LegacyProviderIdentity {
  id: string;
  tenant_id: string | null;
  provider: string;
  provider_subscription_id: string;
  provider_synced_at: string | Date | null;
}

async function backfillLegacyProviderBindings(knex: Knex): Promise<void> {
  let cursor: string | null = null;
  while (true) {
    let query = knex(TABLE)
      .select('id', 'tenant_id', 'provider', 'provider_subscription_id', 'provider_synced_at')
      .whereNotNull('provider')
      .whereNotNull('provider_subscription_id')
      .orderBy('id')
      .limit(BACKFILL_BATCH_SIZE);
    if (cursor) query = query.where('id', '>', cursor);
    const batch = (await query) as LegacyProviderIdentity[];
    if (batch.length === 0) return;
    const timestamp = new Date().toISOString();
    await knex(BINDINGS_TABLE)
      .insert(
        batch.map((row) => ({
          id: globalThis.crypto.randomUUID(),
          tenant_id: row.tenant_id,
          tenant_key: row.tenant_id ?? '',
          subscription_id: row.id,
          provider: row.provider,
          provider_subscription_id: row.provider_subscription_id,
          provider_synced_at: row.provider_synced_at,
          created_at: timestamp,
          updated_at: timestamp,
        })),
      )
      .onConflict(['tenant_key', 'subscription_id', 'provider'])
      .ignore();
    cursor = batch.at(-1)?.id ?? null;
  }
}

async function assertNoMissingLegacyProviderBinding(knex: Knex): Promise<void> {
  const missing = await knex(`${TABLE} as subscription`)
    .leftJoin(`${BINDINGS_TABLE} as binding`, function joinBinding() {
      this.on('binding.tenant_key', '=', 'subscription.tenant_key')
        .andOn('binding.subscription_id', '=', 'subscription.id')
        .andOn('binding.provider', '=', 'subscription.provider')
        .andOn('binding.provider_subscription_id', '=', 'subscription.provider_subscription_id');
    })
    .whereNotNull('subscription.provider')
    .whereNotNull('subscription.provider_subscription_id')
    .whereNull('binding.id')
    .first('subscription.id');
  if (missing) throw new Error(`${BINDINGS_TABLE} is missing a legacy provider identity`);
}

async function ensureBindingConsistencyCheck(knex: Knex): Promise<void> {
  const name = 'payable_subscription_bindings_tenant_key_consistency_check';
  if (await checkConstraintExists(knex, BINDINGS_TABLE, name)) return;
  await knex.schema.alterTable(BINDINGS_TABLE, (table) => {
    table.check("tenant_key = COALESCE(tenant_id, '')", {}, name);
  });
}

async function assertNoDuplicateIdentity(
  knex: Knex,
  columns: string[],
  identity: string,
  requiredColumn?: string,
): Promise<void> {
  let query = knex(TABLE).select(columns).count({ count: '*' }).groupBy(columns);
  if (requiredColumn) query = query.whereNotNull(requiredColumn);
  if (await query.havingRaw('COUNT(*) > 1').first()) {
    throw new Error(`${TABLE} has duplicate tenant-scoped ${identity} identities`);
  }
}

async function ensureUniqueIndex(
  knex: Knex,
  table: string,
  name: string,
  columns: string[],
): Promise<void> {
  if (await indexExists(knex, table, name)) return;
  const placeholders = columns.map(() => '??').join(', ');
  await knex.raw(`CREATE UNIQUE INDEX ?? ON ?? (${placeholders})`, [name, table, ...columns]);
}

export async function dropLegacyUniqueIdentity(knex: Knex, name: string): Promise<void> {
  if (!(await indexExists(knex, TABLE, name))) return;
  const dialect = dialectOf(knex);
  if (dialect === 'postgresql' && (await uniqueConstraintExists(knex, TABLE, name))) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [TABLE, name]);
    return;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    await knex.raw('DROP INDEX ?? ON ??', [name, TABLE]);
    return;
  }
  await knex.raw('DROP INDEX ??', [name]);
}

async function uniqueConstraintExists(
  knex: Knex,
  table: string,
  constraint: string,
): Promise<boolean> {
  const result = (await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = ANY(current_schemas(false)) AND t.relname = ? AND c.conname = ? AND c.contype = 'u') AS present",
    [table, constraint],
  )) as { rows?: { present?: boolean }[] };
  return result.rows?.[0]?.present === true;
}

async function ensureSubscriptionConsistencyCheck(knex: Knex): Promise<void> {
  const name = 'payable_subscriptions_tenant_key_consistency_check';
  if (await checkConstraintExists(knex, TABLE, name)) return;
  await knex.schema.alterTable(TABLE, (table) => {
    table.check("tenant_key = COALESCE(tenant_id, '')", {}, name);
  });
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
  throw new Error(`Unsupported database dialect for subscription index introspection: ${dialect}`);
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
  throw new Error(
    `Unsupported database dialect for subscription constraint introspection: ${dialect}`,
  );
}

function dialectOf(knex: Knex): string | undefined {
  return (knex.client as { dialect?: string }).dialect;
}
