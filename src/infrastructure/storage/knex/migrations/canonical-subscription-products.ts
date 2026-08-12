import type { Knex } from 'knex';

const SUBSCRIPTIONS_TABLE = 'payable_subscriptions';
const PRICES_TABLE = 'payable_canonical_prices';
const INDEX_NAME = 'payable_subscriptions_tenant_product_page_idx';
const BACKFILL_BATCH_SIZE = 500;

export interface CanonicalSubscriptionProductMigrationReport {
  backfilled: number;
  unresolved: number;
}

interface SubscriptionSnapshotRow {
  id: string;
  tenant_key: string;
  canonical_price_id: string;
}

interface CanonicalPriceRow {
  id: string;
  tenant_key: string;
  product_id: string;
}

export async function addCanonicalSubscriptionProducts(
  knex: Knex,
): Promise<CanonicalSubscriptionProductMigrationReport> {
  if (!(await knex.schema.hasTable(SUBSCRIPTIONS_TABLE))) {
    return { backfilled: 0, unresolved: 0 };
  }

  if (!(await knex.schema.hasColumn(SUBSCRIPTIONS_TABLE, 'canonical_product_id'))) {
    try {
      await knex.schema.alterTable(SUBSCRIPTIONS_TABLE, (table) => {
        table.uuid('canonical_product_id').nullable();
      });
    } catch (error) {
      if (!(await knex.schema.hasColumn(SUBSCRIPTIONS_TABLE, 'canonical_product_id'))) {
        throw error;
      }
    }
  }

  const report = await backfillCanonicalProductIds(knex);
  await ensureProductPageIndex(knex);
  return report;
}

async function backfillCanonicalProductIds(
  knex: Knex,
): Promise<CanonicalSubscriptionProductMigrationReport> {
  if (!(await knex.schema.hasTable(PRICES_TABLE))) {
    return countUnresolved(knex, 0);
  }

  let backfilled = 0;
  let cursor: string | null = null;
  while (true) {
    let query = knex(SUBSCRIPTIONS_TABLE)
      .select('id', 'tenant_key', 'canonical_price_id')
      .whereNull('canonical_product_id')
      .whereNotNull('canonical_price_id')
      .orderBy('id')
      .limit(BACKFILL_BATCH_SIZE);
    if (cursor) query = query.where('id', '>', cursor);
    const subscriptions = (await query) as SubscriptionSnapshotRow[];
    if (subscriptions.length === 0) break;

    const prices = await readMatchingPrices(knex, subscriptions);
    const productsByPrice = new Map(
      prices.map((price) => [`${price.tenant_key}\u0000${price.id}`, price.product_id]),
    );
    for (const subscription of subscriptions) {
      const productId = productsByPrice.get(
        `${subscription.tenant_key}\u0000${subscription.canonical_price_id}`,
      );
      if (!productId) continue;
      backfilled += await knex(SUBSCRIPTIONS_TABLE)
        .where({ id: subscription.id, tenant_key: subscription.tenant_key })
        .whereNull('canonical_product_id')
        .update({ canonical_product_id: productId });
    }
    cursor = subscriptions.at(-1)?.id ?? null;
  }

  return countUnresolved(knex, backfilled);
}

async function readMatchingPrices(
  knex: Knex,
  subscriptions: SubscriptionSnapshotRow[],
): Promise<CanonicalPriceRow[]> {
  return knex(PRICES_TABLE)
    .select('id', 'tenant_key', 'product_id')
    .where((prices) => {
      for (const subscription of subscriptions) {
        prices.orWhere({
          id: subscription.canonical_price_id,
          tenant_key: subscription.tenant_key,
        });
      }
    }) as Promise<CanonicalPriceRow[]>;
}

async function countUnresolved(
  knex: Knex,
  backfilled: number,
): Promise<CanonicalSubscriptionProductMigrationReport> {
  const row = (await knex(SUBSCRIPTIONS_TABLE)
    .whereNull('canonical_product_id')
    .whereNotNull('canonical_price_id')
    .count({ count: '*' })
    .first()) as { count?: number | string } | undefined;
  return { backfilled, unresolved: Number(row?.count ?? 0) };
}

async function ensureProductPageIndex(knex: Knex): Promise<void> {
  if (await productPageIndexExists(knex)) return;
  try {
    await knex.schema.alterTable(SUBSCRIPTIONS_TABLE, (table) => {
      table.index(['tenant_key', 'canonical_product_id', 'created_at', 'id'], INDEX_NAME);
    });
  } catch (error) {
    if (!(await productPageIndexExists(knex))) throw error;
  }
}

async function productPageIndexExists(knex: Knex): Promise<boolean> {
  const dialect = (knex.client as { dialect?: string }).dialect;
  if (dialect === 'sqlite3' || dialect === 'better-sqlite3') {
    return Boolean(await knex('sqlite_master').where({ type: 'index', name: INDEX_NAME }).first());
  }
  if (dialect === 'postgresql') {
    const result = (await knex.raw(
      'SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = ANY(current_schemas(false)) AND tablename = ? AND indexname = ?) AS present',
      [SUBSCRIPTIONS_TABLE, INDEX_NAME],
    )) as { rows?: { present?: boolean }[] };
    return result.rows?.[0]?.present === true;
  }
  if (dialect === 'mysql' || dialect === 'mariadb') {
    const [rows] = (await knex.raw(
      'SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      [SUBSCRIPTIONS_TABLE, INDEX_NAME],
    )) as [{ count?: number | string }[], unknown];
    return Number(rows[0]?.count ?? 0) > 0;
  }
  throw new Error(`Unsupported database dialect for subscription index introspection: ${dialect}`);
}
