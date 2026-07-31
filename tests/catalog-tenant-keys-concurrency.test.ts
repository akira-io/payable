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

describe('catalog tenant key migration write safety', () => {
  it('revisits a mismatched row inserted below the active backfill cursor', async () => {
    await createBeta3Catalog(db);
    await recordPreCatalogSteps(db);
    await db.schema.alterTable('payable_products', (table) => {
      table.string('tenant_key').notNullable().defaultTo('');
    });
    await db('payable_products').insert(
      Array.from({ length: 100 }, (_, index) =>
        legacyProduct(`product-${String(index).padStart(3, '0')}`, 'tenant-a', `prod-${index}`),
      ),
    );
    await db.raw(`
      CREATE TRIGGER payable_products_late_legacy_insert
      AFTER UPDATE OF tenant_key ON payable_products
      WHEN NEW.id = 'product-099'
        AND NOT EXISTS (
          SELECT 1 FROM payable_products WHERE id = 'product-000-late'
        )
      BEGIN
        INSERT INTO payable_products (
          id, tenant_id, provider, provider_product_id, name, description,
          active, metadata, created_at, updated_at
        ) VALUES (
          'product-000-late', 'tenant-late', 'stripe', 'prod-late',
          'Late product', NULL, 1, NULL,
          '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
        );
      END
    `);

    await migrate(db);

    await expect(
      db('payable_products').where({ id: 'product-000-late' }).first('tenant_key'),
    ).resolves.toMatchObject({ tenant_key: 'tenant-late' });
  });

  it('rejects legacy tenant-owned inserts that omit tenant_key after migration', async () => {
    await createBeta3Catalog(db);
    await recordPreCatalogSteps(db);
    await migrate(db);

    await expect(
      db('payable_products').insert(
        legacyProduct('legacy-product', 'tenant-a', 'prod_legacy_write'),
      ),
    ).rejects.toThrow();
    await expect(
      db('payable_prices').insert(legacyPrice('legacy-price', 'tenant-a', 'price_legacy_write')),
    ).rejects.toThrow();
  });
});

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
    ].map((name) => ({ name, applied_at: timestamp() })),
  );
}

async function createBeta3Catalog(knex: Knex): Promise<void> {
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
      builder.unique(['provider', providerColumn], `${table}_provider_${providerColumn}_unique`);
    });
  }
}

function legacyProduct(id: string, tenantId: string, providerId: string) {
  return {
    id,
    tenant_id: tenantId,
    provider: 'stripe',
    provider_product_id: providerId,
    name: id,
    description: null,
    active: true,
    metadata: null,
    created_at: timestamp(),
    updated_at: timestamp(),
  };
}

function legacyPrice(id: string, tenantId: string, providerId: string) {
  return {
    id,
    tenant_id: tenantId,
    provider: 'stripe',
    provider_price_id: providerId,
    product_id: 'product-id',
    currency: 'USD',
    unit_amount: 1000,
    interval: 'month',
    interval_count: 1,
    active: true,
    created_at: timestamp(),
    updated_at: timestamp(),
  };
}

function timestamp(): string {
  return '2026-07-31T00:00:00.000Z';
}
