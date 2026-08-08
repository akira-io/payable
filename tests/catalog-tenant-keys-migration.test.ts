import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';

let db: Knex;

beforeEach(() => {
  db = createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

describe('catalog tenant keys migration', () => {
  it('normalizes catalog identities per tenant and across tenantless rows', async () => {
    await migrate(db);

    expect(await db.schema.hasColumn('payable_products', 'tenant_key')).toBe(true);
    expect(await db.schema.hasColumn('payable_prices', 'tenant_key')).toBe(true);
    const now = new Date().toISOString();
    await db('payable_products').insert([
      product('product-a', 'tenant-a', 'prod_shared', now),
      product('product-b', 'tenant-b', 'prod_shared', now),
      product('product-general', null, 'prod_general', now),
    ]);
    await expect(
      db('payable_products').insert(product('product-duplicate', null, 'prod_general', now)),
    ).rejects.toThrow();

    await db('payable_prices').insert([
      price('price-a', 'tenant-a', 'price_shared', now),
      price('price-b', 'tenant-b', 'price_shared', now),
      price('price-general', null, 'price_general', now),
    ]);
    await expect(
      db('payable_prices').insert(price('price-duplicate', null, 'price_general', now)),
    ).rejects.toThrow();

    const indexes = (await db
      .from('sqlite_master')
      .where({ type: 'index' })
      .pluck('name')) as string[];
    expect(indexes).toContain('payable_products_tenant_provider_product_unique');
    expect(indexes).toContain('payable_prices_tenant_provider_price_unique');
  });

  it('backfills more than two batches from beta3 catalog tables', async () => {
    await createBeta3Catalog(db);
    await recordPreCatalogSteps(db);
    const now = new Date().toISOString();
    await db('payable_products').insert(
      Array.from({ length: 205 }, (_, index) =>
        legacyProduct(
          `product-${index}`,
          index % 2 === 0 ? null : 'tenant-a',
          `prod-${index}`,
          now,
        ),
      ),
    );
    await db('payable_prices').insert(
      Array.from({ length: 205 }, (_, index) => ({
        ...legacyPrice(
          `price-${index}`,
          index % 2 === 0 ? null : 'tenant-a',
          `price-${index}`,
          now,
        ),
        product_id: `product-${index}`,
      })),
    );

    await migrate(db);

    await expect(tenantKeyOf('payable_products', 'product-0')).resolves.toBe('');
    await expect(tenantKeyOf('payable_products', 'product-101')).resolves.toBe('tenant-a');
    await expect(tenantKeyOf('payable_products', 'product-204')).resolves.toBe('');
    await expect(tenantKeyOf('payable_prices', 'price-0')).resolves.toBe('');
    await expect(tenantKeyOf('payable_prices', 'price-101')).resolves.toBe('tenant-a');
    await expect(tenantKeyOf('payable_prices', 'price-204')).resolves.toBe('');
  });

  it('repairs incomplete catalog tenant-key backfills independently of index state', async () => {
    await createBeta3Catalog(db);
    await recordPreCatalogSteps(db);
    await db.schema.alterTable('payable_products', (table) => {
      table.string('tenant_key').notNullable().defaultTo('');
    });
    await db('payable_products').insert([
      legacyProduct('stale-product', 'tenant-a', 'prod_stale', now()),
      legacyProduct('control-product', 'tenant-b', 'prod_control', now()),
    ]);
    await db('payable_products')
      .where({ id: 'control-product' })
      .update({ tenant_key: 'tenant-b' });

    await migrate(db);

    await expect(tenantKeyOf('payable_products', 'stale-product')).resolves.toBe('tenant-a');
    await expect(tenantKeyOf('payable_products', 'control-product')).resolves.toBe('tenant-b');
    expect(
      await db('payable_migrations').where({ name: '009-catalog-tenant-keys' }).first(),
    ).toBeDefined();
  });

  it('replaces a legacy catalog index from a partial migration state', async () => {
    await createBeta3Catalog(db);
    await recordPreCatalogSteps(db);
    await db.schema.alterTable('payable_products', (table) => {
      table.string('tenant_key').notNullable().defaultTo('');
    });
    await db('payable_products').insert(
      legacyProduct('partial-product', 'tenant-a', 'prod_partial', now()),
    );
    await db('payable_products').update({ tenant_key: 'tenant-a' });
    await db.raw('CREATE UNIQUE INDEX ?? ON ?? (??, ??, ??)', [
      'payable_products_tenant_provider_product_unique',
      'payable_products',
      'tenant_key',
      'provider',
      'provider_product_id',
    ]);

    await migrate(db);

    expect(await hasIndex('payable_products_tenant_provider_product_unique')).toBe(true);
    expect(await hasIndex('payable_products_provider_provider_product_id_unique')).toBe(false);
  });

  it('records the catalog step without changing an already normalized schema', async () => {
    await createBeta3Catalog(db);
    await recordPreCatalogSteps(db);
    await addNormalizedIndexes(db);

    await migrate(db);

    expect(await hasIndex('payable_products_tenant_provider_product_unique')).toBe(true);
    expect(await hasIndex('payable_prices_tenant_provider_price_unique')).toBe(true);
    expect(
      await db('payable_migrations').where({ name: '009-catalog-tenant-keys' }).first(),
    ).toBeDefined();
  });

  it('retains the legacy index when duplicate normalized identities block migration', async () => {
    await createBeta3Catalog(db, false);
    await recordPreCatalogSteps(db);
    await db('payable_products').insert([
      legacyProduct('duplicate-a', 'tenant-a', 'prod_duplicate', now()),
      legacyProduct('duplicate-b', 'tenant-a', 'prod_duplicate', now()),
    ]);

    await expect(migrate(db)).rejects.toThrow(/payable_products.*tenant-a.*stripe.*prod_duplicate/);
    expect(await hasIndex('payable_products_provider_provider_product_id_unique')).toBe(true);
  });
});

function now(): string {
  return new Date().toISOString();
}

async function tenantKeyOf(table: string, id: string): Promise<string> {
  const row = await db(table).where({ id }).first('tenant_key');
  return row.tenant_key as string;
}

async function hasIndex(name: string): Promise<boolean> {
  return Boolean(await db('sqlite_master').where({ type: 'index', name }).first());
}

async function recordPreCatalogSteps(knex: Knex): Promise<void> {
  await knex.schema.createTable('payable_migrations', (table) => {
    table.string('name').primary();
    table.timestamp('applied_at').notNullable();
  });
  await knex('payable_migrations').insert(
    [
      '001-billing-tables',
      '002-system-tables',
      '003-alter-existing-tables',
      '004-widen-endpoint-secret',
      '005-webhook-occurred-at',
      '006-subscription-provider-synced-at',
      '007-post-ledger-schema-convergence',
      '008-customer-provider-bindings',
    ].map((name) => ({
      name,
      applied_at: now(),
    })),
  );
}

async function createBeta3Catalog(knex: Knex, unique = true): Promise<void> {
  for (const [table, providerColumn] of [
    ['payable_products', 'provider_product_id'],
    ['payable_prices', 'provider_price_id'],
  ] as const) {
    await knex.schema.createTable(table, (builder) => {
      builder.string('id').primary();
      builder.string('tenant_id').nullable();
      builder.string('provider').notNullable();
      builder.string(providerColumn).nullable();
      if (table === 'payable_products') {
        builder.string('name').notNullable();
        builder.text('description').nullable();
        builder.boolean('active').notNullable();
        builder.text('metadata').nullable();
      } else {
        builder.string('product_id').notNullable();
        builder.string('currency').notNullable();
        builder.bigInteger('unit_amount').notNullable();
        builder.string('interval').nullable();
        builder.integer('interval_count').nullable();
        builder.boolean('active').notNullable();
      }
      builder.timestamp('created_at').notNullable();
      builder.timestamp('updated_at').notNullable();
      if (unique) {
        builder.unique(['provider', providerColumn], `${table}_provider_${providerColumn}_unique`);
      } else {
        builder.index(['provider', providerColumn], `${table}_provider_${providerColumn}_unique`);
      }
    });
  }
}

async function addNormalizedIndexes(knex: Knex): Promise<void> {
  for (const [table, providerColumn, index] of [
    ['payable_products', 'provider_product_id', 'payable_products_tenant_provider_product_unique'],
    ['payable_prices', 'provider_price_id', 'payable_prices_tenant_provider_price_unique'],
  ] as const) {
    await knex.schema.alterTable(table, (builder) => {
      builder.string('tenant_key').notNullable().defaultTo('');
    });
    await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??, ??, ??)', [
      index,
      table,
      'tenant_key',
      'provider',
      providerColumn,
    ]);
    await knex.raw('DROP INDEX ??', [`${table}_provider_${providerColumn}_unique`]);
  }
}

function product(id: string, tenantId: string | null, providerId: string, now: string) {
  return {
    id,
    tenant_id: tenantId,
    tenant_key: tenantId ?? '',
    provider: 'stripe',
    provider_product_id: providerId,
    name: id,
    description: null,
    active: true,
    metadata: null,
    created_at: now,
    updated_at: now,
  };
}

function legacyProduct(id: string, tenantId: string | null, providerId: string, now: string) {
  const { tenant_key: ignored, ...row } = product(id, tenantId, providerId, now);
  return row;
}

function price(id: string, tenantId: string | null, providerId: string, now: string) {
  return {
    id,
    tenant_id: tenantId,
    tenant_key: tenantId ?? '',
    provider: 'stripe',
    provider_price_id: providerId,
    product_id: 'product_id',
    currency: 'USD',
    unit_amount: 1000,
    interval: 'month',
    interval_count: 1,
    active: true,
    created_at: now,
    updated_at: now,
  };
}

function legacyPrice(id: string, tenantId: string | null, providerId: string, now: string) {
  const { tenant_key: ignored, ...row } = price(id, tenantId, providerId, now);
  return row;
}
