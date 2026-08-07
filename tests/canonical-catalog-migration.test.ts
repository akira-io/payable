import { describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';

const APPLIED_BEFORE_CANONICAL_CATALOG = [
  '001-billing-tables',
  '002-system-tables',
  '003-alter-existing-tables',
  '004-widen-endpoint-secret',
  '005-webhook-occurred-at',
  '006-subscription-provider-synced-at',
  '007-post-ledger-schema-convergence',
  '008-customer-provider-bindings',
  '009-catalog-tenant-keys',
  '010-subscription-lifecycle-metadata',
] as const;

describe('canonical catalog migration', () => {
  it('adds canonical tables to a database with all earlier ledger steps applied', async () => {
    const database = createTestDb();
    await database.schema.createTable('payable_migrations', (table) => {
      table.string('name').primary();
      table.timestamp('applied_at').notNullable();
    });
    await database('payable_migrations').insert(
      APPLIED_BEFORE_CANONICAL_CATALOG.map((name) => ({
        name,
        applied_at: new Date('2026-08-07T00:00:00.000Z').toISOString(),
      })),
    );

    await migrate(database);

    await expect(database.schema.hasTable('payable_canonical_products')).resolves.toBe(true);
    await expect(database.schema.hasTable('payable_canonical_prices')).resolves.toBe(true);
    await expect(database.schema.hasTable('payable_product_provider_bindings')).resolves.toBe(true);
    await expect(database.schema.hasTable('payable_price_provider_bindings')).resolves.toBe(true);

    await database.destroy();
  });

  it('removes price provider bindings when their canonical price is deleted', async () => {
    const database = createTestDb();
    await migrate(database);
    const timestamp = new Date('2026-08-07T00:00:00.000Z').toISOString();

    await database('payable_canonical_products').insert({
      id: '00000000-0000-4000-8000-000000000001',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await database('payable_canonical_prices').insert({
      id: '00000000-0000-4000-8000-000000000002',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      product_id: '00000000-0000-4000-8000-000000000001',
      currency: 'EUR',
      unit_amount: 2900,
      type: 'recurring',
      interval: 'month',
      interval_count: 1,
      description: null,
      lookup_key: 'pro_monthly',
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await database('payable_price_provider_bindings').insert({
      id: '00000000-0000-4000-8000-000000000003',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      price_id: '00000000-0000-4000-8000-000000000002',
      provider: 'stripe-primary',
      provider_price_id: 'price_123',
      created_at: timestamp,
      updated_at: timestamp,
    });

    await database('payable_canonical_prices')
      .where({ id: '00000000-0000-4000-8000-000000000002' })
      .delete();

    await expect(database('payable_price_provider_bindings')).resolves.toHaveLength(0);
    await database.destroy();
  });
});
