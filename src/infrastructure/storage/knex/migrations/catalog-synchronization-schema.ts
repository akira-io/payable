import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

export async function addCatalogSynchronizationTable(knex: Knex): Promise<void> {
  await createIfMissing(knex, 'payable_catalog_synchronizations', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.string('provider').notNullable();
    table.string('resource_type').notNullable();
    table.uuid('resource_id').notNullable();
    table.string('operation').notNullable();
    table.string('canonical_version').notNullable();
    table.string('idempotency_key').notNullable();
    table.string('status').notNullable();
    table.string('reconciliation_state').notNullable();
    table.string('provider_resource_id').nullable();
    table.string('provider_resource_version').nullable();
    table.integer('retry_count').notNullable().defaultTo(0);
    table.string('last_error_code').nullable();
    table.timestamp('last_attempted_at', { useTz: true }).nullable();
    table.timestamp('last_succeeded_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.check(
      "tenant_key = COALESCE(tenant_id, '')",
      {},
      'payable_catalog_sync_tenant_key_consistency_check',
    );
    table.unique(['tenant_key', 'provider', 'resource_type', 'resource_id'], {
      indexName: 'payable_catalog_sync_resource_unique',
    });
    table.unique(['tenant_key', 'id'], {
      indexName: 'payable_catalog_sync_tenant_id_unique',
    });
    table.index(['tenant_key', 'status', 'updated_at'], 'payable_catalog_sync_status_index');
  });
}
