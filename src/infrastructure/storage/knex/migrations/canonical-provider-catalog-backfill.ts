import type { Knex } from 'knex';

const LEGACY_PRODUCTS = 'payable_products';
const LEGACY_PRICES = 'payable_prices';
const PRODUCTS = 'payable_canonical_products';
const PRICES = 'payable_canonical_prices';
const PRODUCT_BINDINGS = 'payable_product_provider_bindings';
const PRICE_BINDINGS = 'payable_price_provider_bindings';
const BATCH_SIZE = 100;

interface LegacyProductRow {
  id: string;
  tenant_id: string | null;
  tenant_key: string;
  provider: string;
  provider_product_id: string | null;
  name: string;
  description: string | null;
  active: boolean | number;
  metadata: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface LegacyPriceRow {
  id: string;
  tenant_id: string | null;
  tenant_key: string;
  provider: string;
  provider_price_id: string | null;
  product_id: string;
  currency: string;
  unit_amount: number | string;
  interval: string | null;
  interval_count: number | null;
  active: boolean | number;
  created_at: string | Date;
  updated_at: string | Date;
}

export async function backfillCanonicalProviderCatalog(knex: Knex): Promise<void> {
  await assertCatalogTables(knex);
  await assertLegacyCatalogRelationships(knex);
  await backfillProducts(knex);
  await backfillPrices(knex);
}

async function assertCatalogTables(knex: Knex): Promise<void> {
  for (const table of [
    LEGACY_PRODUCTS,
    LEGACY_PRICES,
    PRODUCTS,
    PRICES,
    PRODUCT_BINDINGS,
    PRICE_BINDINGS,
  ]) {
    if (!(await knex.schema.hasTable(table))) {
      throw new Error(`Cannot backfill canonical provider catalog: missing table ${table}`);
    }
  }
}

async function assertLegacyCatalogRelationships(knex: Knex): Promise<void> {
  const orphan = await knex(`${LEGACY_PRICES} as price`)
    .leftJoin(`${LEGACY_PRODUCTS} as product`, 'product.id', 'price.product_id')
    .whereNull('product.id')
    .first('price.id', 'price.product_id');
  if (orphan) {
    throw new Error(
      `Cannot backfill legacy price ${orphan.id as string}: product ${orphan.product_id as string} does not exist`,
    );
  }
  const crossTenant = await knex(`${LEGACY_PRICES} as price`)
    .join(`${LEGACY_PRODUCTS} as product`, 'product.id', 'price.product_id')
    .whereRaw('price.tenant_key <> product.tenant_key')
    .first('price.id', 'price.product_id');
  if (crossTenant) {
    throw new Error(
      `Cannot backfill legacy price ${crossTenant.id as string}: product ${crossTenant.product_id as string} belongs to another tenant`,
    );
  }
  const crossProvider = await knex(`${LEGACY_PRICES} as price`)
    .join(`${LEGACY_PRODUCTS} as product`, 'product.id', 'price.product_id')
    .whereRaw('price.provider <> product.provider')
    .first('price.id', 'price.product_id');
  if (crossProvider) {
    throw new Error(
      `Cannot backfill legacy price ${crossProvider.id as string}: product ${crossProvider.product_id as string} belongs to another provider`,
    );
  }
}

async function backfillProducts(knex: Knex): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const query = knex<LegacyProductRow>(LEGACY_PRODUCTS)
      .select('*')
      .orderBy('id')
      .limit(BATCH_SIZE);
    if (cursor) query.where('id', '>', cursor);
    const rows = await query;
    if (rows.length === 0) return;
    for (const row of rows) await backfillProduct(knex, row);
    cursor = rows.at(-1)?.id;
  }
}

async function backfillProduct(knex: Knex, row: LegacyProductRow): Promise<void> {
  const canonical = canonicalProduct(row);
  const existing = await knex(PRODUCTS).where({ id: row.id }).first();
  if (existing && !sameProduct(existing, canonical)) {
    throw new Error(
      `Cannot backfill legacy product ${row.id}: canonical row has conflicting preserved fields`,
    );
  }
  if (!existing) await knex(PRODUCTS).insert(canonical).onConflict('id').ignore();
  if (!row.provider_product_id) return;
  const binding = {
    id: globalThis.crypto.randomUUID(),
    tenant_id: row.tenant_id,
    tenant_key: row.tenant_key,
    product_id: row.id,
    provider: row.provider,
    provider_product_id: row.provider_product_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  await assertBindingCompatible(knex, PRODUCT_BINDINGS, binding, 'product');
  await knex(PRODUCT_BINDINGS)
    .insert(binding)
    .onConflict(['tenant_key', 'product_id', 'provider'])
    .ignore();
}

async function backfillPrices(knex: Knex): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const query = knex<LegacyPriceRow>(LEGACY_PRICES).select('*').orderBy('id').limit(BATCH_SIZE);
    if (cursor) query.where('id', '>', cursor);
    const rows = await query;
    if (rows.length === 0) return;
    for (const row of rows) await backfillPrice(knex, row);
    cursor = rows.at(-1)?.id;
  }
}

async function backfillPrice(knex: Knex, row: LegacyPriceRow): Promise<void> {
  const canonical = canonicalPrice(row);
  const existing = await knex(PRICES).where({ id: row.id }).first();
  if (existing && !samePrice(existing, canonical)) {
    throw new Error(
      `Cannot backfill legacy price ${row.id}: canonical row has conflicting preserved fields`,
    );
  }
  if (!existing) await knex(PRICES).insert(canonical).onConflict('id').ignore();
  if (!row.provider_price_id) return;
  const binding = {
    id: globalThis.crypto.randomUUID(),
    tenant_id: row.tenant_id,
    tenant_key: row.tenant_key,
    price_id: row.id,
    provider: row.provider,
    provider_price_id: row.provider_price_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  await assertBindingCompatible(knex, PRICE_BINDINGS, binding, 'price');
  await knex(PRICE_BINDINGS)
    .insert(binding)
    .onConflict(['tenant_key', 'price_id', 'provider'])
    .ignore();
}

async function assertBindingCompatible(
  knex: Knex,
  table: string,
  binding: Record<string, unknown>,
  resource: 'product' | 'price',
): Promise<void> {
  const resourceId = `${resource}_id`;
  const providerId = `provider_${resource}_id`;
  const byResource = await knex(table)
    .where({
      tenant_key: binding.tenant_key,
      [resourceId]: binding[resourceId],
      provider: binding.provider,
    })
    .first();
  if (byResource && byResource[providerId] !== binding[providerId]) {
    throw new Error(
      `Cannot backfill legacy ${resource} ${binding[resourceId] as string}: canonical binding has a different provider id`,
    );
  }
  const byProvider = await knex(table)
    .where({
      tenant_key: binding.tenant_key,
      provider: binding.provider,
      [providerId]: binding[providerId],
    })
    .first();
  if (byProvider && byProvider[resourceId] !== binding[resourceId]) {
    throw new Error(
      `Cannot backfill legacy ${resource} ${binding[resourceId] as string}: provider id is bound to ${byProvider[resourceId] as string}`,
    );
  }
}

function canonicalProduct(row: LegacyProductRow): Record<string, unknown> {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_key: row.tenant_key,
    name: row.name,
    description: row.description,
    active: row.active,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function canonicalPrice(row: LegacyPriceRow): Record<string, unknown> {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_key: row.tenant_key,
    product_id: row.product_id,
    currency: row.currency,
    unit_amount: row.unit_amount,
    type: row.interval ? 'recurring' : 'one_time',
    interval: row.interval,
    interval_count: row.interval_count,
    description: null,
    lookup_key: null,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sameProduct(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return sameFields(existing, expected, [
    'tenant_id',
    'tenant_key',
    'name',
    'description',
    'active',
    'metadata',
    'created_at',
    'updated_at',
  ]);
}

function samePrice(existing: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return sameFields(existing, expected, [
    'tenant_id',
    'tenant_key',
    'product_id',
    'currency',
    'unit_amount',
    'type',
    'interval',
    'interval_count',
    'active',
    'created_at',
    'updated_at',
  ]);
}

function sameFields(
  existing: Record<string, unknown>,
  expected: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.every((field) => normalized(existing[field]) === normalized(expected[field]));
}

function normalized(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value ?? '');
}
