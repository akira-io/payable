import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';

const MIGRATION = '017-canonical-provider-catalog-backfill';
const TIMESTAMP = '2026-08-08T00:00:00.000Z';

let database: Knex;

beforeEach(async () => {
  database = createTestDb();
  await migrate(database);
  await database('payable_migrations').where({ name: MIGRATION }).delete();
});

afterEach(async () => {
  await database.destroy();
});

describe('canonical provider catalog backfill migration', () => {
  it('preserves legacy products, prices, relationships, terms, and provider identities', async () => {
    await database('payable_products').insert([
      legacyProduct('00000000-0000-4000-8000-000000000001', 'prod_pro'),
      legacyProduct('00000000-0000-4000-8000-000000000002', null),
    ]);
    await database('payable_prices').insert(
      legacyPrice(
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000001',
        'price_pro_monthly',
      ),
    );

    await migrate(database);

    await expect(
      database('payable_canonical_products')
        .where({ id: '00000000-0000-4000-8000-000000000001' })
        .first(),
    ).resolves.toMatchObject({
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      name: 'Pro',
      description: 'Legacy product',
      active: 1,
      metadata: '{"segment":"business"}',
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });
    await expect(
      database('payable_product_provider_bindings')
        .where({ product_id: '00000000-0000-4000-8000-000000000001' })
        .first(),
    ).resolves.toMatchObject({
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      provider: 'stripe',
      provider_product_id: 'prod_pro',
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });
    await expect(
      database('payable_product_provider_bindings')
        .where({ product_id: '00000000-0000-4000-8000-000000000002' })
        .first(),
    ).resolves.toBeUndefined();
    await expect(
      database('payable_canonical_prices')
        .where({ id: '00000000-0000-4000-8000-000000000003' })
        .first(),
    ).resolves.toMatchObject({
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      product_id: '00000000-0000-4000-8000-000000000001',
      currency: 'EUR',
      unit_amount: 2900,
      type: 'recurring',
      interval: 'month',
      interval_count: 1,
      active: 1,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });
    await expect(
      database('payable_price_provider_bindings')
        .where({ price_id: '00000000-0000-4000-8000-000000000003' })
        .first(),
    ).resolves.toMatchObject({
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      provider: 'stripe',
      provider_price_id: 'price_pro_monthly',
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });
    await expect(
      database('payable_migrations').where({ name: MIGRATION }).first(),
    ).resolves.toBeDefined();
  });

  it('resumes a partially completed backfill without duplicating canonical rows or bindings', async () => {
    const productId = '00000000-0000-4000-8000-000000000011';
    await database('payable_products').insert(legacyProduct(productId, 'prod_partial'));
    await database('payable_prices').insert(
      legacyPrice('00000000-0000-4000-8000-000000000012', productId, 'price_partial'),
    );
    await database('payable_canonical_products').insert(canonicalProduct(productId));
    await database('payable_product_provider_bindings').insert({
      id: '00000000-0000-4000-8000-000000000013',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      product_id: productId,
      provider: 'stripe',
      provider_product_id: 'prod_partial',
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });

    await migrate(database);

    await expect(
      database('payable_canonical_products').where({ id: productId }),
    ).resolves.toHaveLength(1);
    await expect(
      database('payable_product_provider_bindings').where({ product_id: productId }),
    ).resolves.toHaveLength(1);
    await expect(
      database('payable_canonical_prices').where({ product_id: productId }),
    ).resolves.toHaveLength(1);
  });

  it('rejects orphaned legacy prices before writing canonical catalog rows', async () => {
    await database('payable_prices').insert(
      legacyPrice(
        '00000000-0000-4000-8000-000000000021',
        '00000000-0000-4000-8000-000000000099',
        'price_orphaned',
      ),
    );

    await expect(migrate(database)).rejects.toThrow(
      'Cannot backfill legacy price 00000000-0000-4000-8000-000000000021: product 00000000-0000-4000-8000-000000000099 does not exist',
    );
    await expect(database('payable_canonical_prices')).resolves.toHaveLength(0);
    await expect(
      database('payable_migrations').where({ name: MIGRATION }).first(),
    ).resolves.toBeUndefined();
  });

  it('rejects a canonical product whose preserved fields conflict with the legacy row', async () => {
    const productId = '00000000-0000-4000-8000-000000000031';
    await database('payable_products').insert(legacyProduct(productId, 'prod_conflict'));
    await database('payable_canonical_products').insert({
      ...canonicalProduct(productId),
      name: 'Different product',
    });

    await expect(migrate(database)).rejects.toThrow(
      `Cannot backfill legacy product ${productId}: canonical row has conflicting preserved fields`,
    );
    await expect(
      database('payable_migrations').where({ name: MIGRATION }).first(),
    ).resolves.toBeUndefined();
  });

  it('rejects a legacy price whose product belongs to another tenant', async () => {
    const productId = '00000000-0000-4000-8000-000000000041';
    const priceId = '00000000-0000-4000-8000-000000000042';
    await database('payable_products').insert(legacyProduct(productId, 'prod_cross_tenant'));
    await database('payable_prices').insert({
      ...legacyPrice(priceId, productId, 'price_cross_tenant'),
      tenant_id: 'tenant-b',
      tenant_key: 'tenant-b',
    });

    await expect(migrate(database)).rejects.toThrow(
      `Cannot backfill legacy price ${priceId}: product ${productId} belongs to another tenant`,
    );
    await expect(
      database('payable_migrations').where({ name: MIGRATION }).first(),
    ).resolves.toBeUndefined();
  });

  it('rejects a canonical binding that maps the legacy product to another provider id', async () => {
    const productId = '00000000-0000-4000-8000-000000000051';
    await database('payable_products').insert(legacyProduct(productId, 'prod_expected'));
    await database('payable_canonical_products').insert(canonicalProduct(productId));
    await database('payable_product_provider_bindings').insert({
      id: '00000000-0000-4000-8000-000000000052',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      product_id: productId,
      provider: 'stripe',
      provider_product_id: 'prod_conflicting',
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });

    await expect(migrate(database)).rejects.toThrow(
      `Cannot backfill legacy product ${productId}: canonical binding has a different provider id`,
    );
    await expect(
      database('payable_migrations').where({ name: MIGRATION }).first(),
    ).resolves.toBeUndefined();
  });

  it('rejects an incomplete catalog schema instead of recording a skipped backfill', async () => {
    await database.schema.dropTable('payable_prices');

    await expect(migrate(database)).rejects.toThrow(
      'Cannot backfill canonical provider catalog: missing table payable_prices',
    );
    await expect(
      database('payable_migrations').where({ name: MIGRATION }).first(),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing binding table even when no legacy rows require bindings', async () => {
    await database.schema.dropTable('payable_product_provider_bindings');

    await expect(migrate(database)).rejects.toThrow(
      'Cannot backfill canonical provider catalog: missing table payable_product_provider_bindings',
    );
    await expect(
      database('payable_migrations').where({ name: MIGRATION }).first(),
    ).resolves.toBeUndefined();
  });
});

function legacyProduct(id: string, providerProductId: string | null) {
  return {
    id,
    tenant_id: 'tenant-a',
    tenant_key: 'tenant-a',
    provider: 'stripe',
    provider_product_id: providerProductId,
    name: 'Pro',
    description: 'Legacy product',
    active: true,
    metadata: '{"segment":"business"}',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function canonicalProduct(id: string) {
  return {
    id,
    tenant_id: 'tenant-a',
    tenant_key: 'tenant-a',
    name: 'Pro',
    description: 'Legacy product',
    active: true,
    metadata: '{"segment":"business"}',
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function legacyPrice(id: string, productId: string, providerPriceId: string) {
  return {
    id,
    tenant_id: 'tenant-a',
    tenant_key: 'tenant-a',
    provider: 'stripe',
    provider_price_id: providerPriceId,
    product_id: productId,
    currency: 'EUR',
    unit_amount: 2900,
    interval: 'month',
    interval_count: 1,
    active: true,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}
