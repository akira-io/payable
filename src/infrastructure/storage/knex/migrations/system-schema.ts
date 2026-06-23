import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

export async function createSystemTables(knex: Knex): Promise<void> {
  await createIfMissing(knex, 'payable_webhook_events', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').notNullable().defaultTo('');
    table.string('provider').notNullable();
    table.string('provider_event_id').notNullable();
    table.string('type').notNullable();
    table.string('normalized_type').nullable();
    table.text('payload').notNullable();
    table.text('data').notNullable();
    table.text('headers').notNullable();
    table.string('status').notNullable();
    table.string('correlation_id').notNullable();
    table.timestamp('received_at').notNullable();
    table.timestamp('processed_at').nullable();
    table.unique(['tenant_id', 'provider', 'provider_event_id']);
  });

  await createIfMissing(knex, 'payable_idempotency_keys', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').notNullable().defaultTo('');
    table.string('key').notNullable();
    table.string('scope').notNullable();
    table.string('operation').notNullable();
    table.string('resource_type').nullable();
    table.string('resource_id').nullable();
    table.string('request_hash').notNullable();
    table.text('response').nullable();
    table.string('status').notNullable();
    table.timestamp('locked_until').nullable();
    table.timestamp('expires_at').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['tenant_id', 'key']);
  });

  await createIfMissing(knex, 'payable_audit_logs', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('correlation_id').notNullable();
    table.string('actor_type').nullable();
    table.string('actor_id').nullable();
    table.string('action').notNullable();
    table.string('resource_type').notNullable();
    table.string('resource_id').notNullable();
    table.text('before').nullable();
    table.text('after').nullable();
    table.text('metadata').nullable();
    table.string('ip_address').nullable();
    table.text('user_agent').nullable();
    table.timestamp('created_at').notNullable();
    table.index(['resource_type', 'resource_id']);
    table.index('correlation_id');
  });

  await createIfMissing(knex, 'payable_outbox_events', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('correlation_id').notNullable();
    table.string('event_type').notNullable();
    table.integer('event_version').notNullable();
    table.text('payload').notNullable();
    table.string('status').notNullable();
    table.integer('attempts').notNullable();
    table.timestamp('next_retry_at').nullable();
    table.string('locked_by').nullable();
    table.timestamp('locked_until').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.index(['status', 'next_retry_at', 'created_at']);
  });

  await createIfMissing(knex, 'payable_webhook_endpoints', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('url').notNullable();
    table.text('events').notNullable();
    table.string('secret').nullable();
    table.string('status').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await createIfMissing(knex, 'payable_webhook_deliveries', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('endpoint_id').notNullable();
    table.string('event_type').notNullable();
    table.text('payload').notNullable();
    table.string('status').notNullable();
    table.integer('attempts').notNullable();
    table.integer('response_code').nullable();
    table.text('response_body').nullable();
    table.timestamp('next_retry_at').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.index('endpoint_id');
  });
}
