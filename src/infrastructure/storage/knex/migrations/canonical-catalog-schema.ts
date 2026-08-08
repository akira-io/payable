import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

export async function addCanonicalCatalogTables(knex: Knex): Promise<void> {
  await createIfMissing(knex, 'payable_canonical_products', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.string('name').notNullable();
    table.text('description').nullable();
    table.boolean('active').notNullable();
    table.text('metadata').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.check(
      "tenant_key = COALESCE(tenant_id, '')",
      {},
      'payable_canonical_products_tenant_key_consistency_check',
    );
    table.unique(['tenant_key', 'id'], {
      indexName: 'payable_canonical_products_tenant_id_unique',
    });
    table.index(['tenant_key', 'created_at', 'id'], 'payable_canonical_products_page_index');
  });

  await createIfMissing(knex, 'payable_canonical_prices', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('product_id').notNullable();
    table.string('currency').notNullable();
    table.bigInteger('unit_amount').notNullable();
    table.string('type').notNullable();
    table.string('interval').nullable();
    table.integer('interval_count').nullable();
    table.text('description').nullable();
    table.string('lookup_key').nullable();
    table.boolean('active').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table
      .foreign(['tenant_key', 'product_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_canonical_products');
    table.unique(['tenant_key', 'lookup_key'], {
      indexName: 'payable_canonical_prices_lookup_key_unique',
    });
    table.check(
      "tenant_key = COALESCE(tenant_id, '')",
      {},
      'payable_canonical_prices_tenant_key_consistency_check',
    );
    table.unique(['tenant_key', 'id'], {
      indexName: 'payable_canonical_prices_tenant_id_unique',
    });
    table.index(
      ['tenant_key', 'product_id', 'created_at', 'id'],
      'payable_canonical_prices_product_page_index',
    );
    table.index(['tenant_key', 'created_at', 'id'], 'payable_canonical_prices_tenant_page_index');
  });

  await createIfMissing(knex, 'payable_price_provider_bindings', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('price_id').notNullable();
    table.string('provider').notNullable();
    table.string('provider_price_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table
      .foreign(['tenant_key', 'price_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_canonical_prices')
      .onDelete('CASCADE');
    table.unique(['tenant_key', 'price_id', 'provider'], {
      indexName: 'payable_price_bindings_price_provider_unique',
    });
    table.unique(['tenant_key', 'provider', 'provider_price_id'], {
      indexName: 'payable_price_bindings_provider_id_unique',
    });
    table.check(
      "tenant_key = COALESCE(tenant_id, '')",
      {},
      'payable_price_bindings_tenant_key_consistency_check',
    );
  });

  await createIfMissing(knex, 'payable_product_provider_bindings', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('product_id').notNullable();
    table.string('provider').notNullable();
    table.string('provider_product_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table
      .foreign(['tenant_key', 'product_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_canonical_products')
      .onDelete('CASCADE');
    table.unique(['tenant_key', 'product_id', 'provider'], {
      indexName: 'payable_product_bindings_product_provider_unique',
    });
    table.unique(['tenant_key', 'provider', 'provider_product_id'], {
      indexName: 'payable_product_bindings_provider_id_unique',
    });
    table.check(
      "tenant_key = COALESCE(tenant_id, '')",
      {},
      'payable_product_bindings_tenant_key_consistency_check',
    );
  });
}
