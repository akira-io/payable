import type { Knex } from 'knex';

async function createLegacyBillingTables(knex: Knex): Promise<void> {
  await knex.schema.createTable('payable_customers', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_customer_id').nullable();
    table.string('billable_type').notNullable();
    table.string('billable_id').notNullable();
    table.string('email').notNullable();
    table.string('name').nullable();
    table.text('metadata').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_customer_id']);
    table.unique(['tenant_id', 'billable_type', 'billable_id']);
  });

  await knex.schema.createTable('payable_products', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_product_id').nullable();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.boolean('active').notNullable();
    table.text('metadata').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_product_id']);
  });

  await knex.schema.createTable('payable_prices', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_price_id').nullable();
    table.uuid('product_id').notNullable();
    table.string('currency').notNullable();
    table.bigInteger('unit_amount').notNullable();
    table.string('interval').nullable();
    table.integer('interval_count').nullable();
    table.boolean('active').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_price_id']);
    table.index('product_id');
  });

  await knex.schema.createTable('payable_subscriptions', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('customer_id').notNullable();
    table.string('name').notNullable();
    table.string('provider').notNullable();
    table.string('provider_subscription_id').nullable();
    table.string('status').notNullable();
    table.uuid('price_id').nullable();
    table.integer('quantity').notNullable();
    table.timestamp('trial_ends_at').nullable();
    table.timestamp('ends_at').nullable();
    table.timestamp('current_period_start').nullable();
    table.timestamp('current_period_end').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_subscription_id']);
    table.unique(['customer_id', 'name']);
  });

  await knex.schema.createTable('payable_subscription_items', (table) => {
    table.uuid('id').primary();
    table.uuid('subscription_id').notNullable();
    table.uuid('price_id').notNullable();
    table.string('provider_item_id').nullable();
    table.integer('quantity').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.index('subscription_id');
  });

  await knex.schema.createTable('payable_invoices', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('customer_id').notNullable();
    table.uuid('subscription_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_invoice_id').nullable();
    table.string('status').notNullable();
    table.string('currency').notNullable();
    table.bigInteger('total').notNullable();
    table.bigInteger('amount_paid').notNullable();
    table.bigInteger('amount_due').notNullable();
    table.string('number').nullable();
    table.text('hosted_invoice_url').nullable();
    table.text('invoice_pdf').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_invoice_id']);
    table.index('customer_id');
  });

  await knex.schema.createTable('payable_payments', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('customer_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_payment_id').nullable();
    table.string('status').notNullable();
    table.string('currency').notNullable();
    table.bigInteger('amount').notNullable();
    table.bigInteger('refunded_amount').notNullable();
    table.string('reference').nullable();
    table.text('description').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_payment_id']);
    table.index('customer_id');
  });

  await knex.schema.createTable('payable_refunds', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('payment_id').notNullable();
    table.string('provider').notNullable();
    table.string('provider_refund_id').nullable();
    table.string('status').notNullable();
    table.string('currency').notNullable();
    table.bigInteger('amount').notNullable();
    table.text('reason').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_refund_id']);
    table.index('payment_id');
  });
}

async function createLegacySystemTables(knex: Knex): Promise<void> {
  await knex.schema.createTable('payable_webhook_events', (table) => {
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

  await knex.schema.createTable('payable_idempotency_keys', (table) => {
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
    table.string('lock_token').nullable();
    table.timestamp('expires_at').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['tenant_id', 'key']);
  });

  await knex.schema.createTable('payable_audit_logs', (table) => {
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
    table.string('previous_hash').nullable();
    table.string('hash').nullable();
    table.integer('sequence').nullable();
    table.timestamp('created_at').notNullable();
    table.index(['resource_type', 'resource_id']);
    table.index('correlation_id');
    table.index(['tenant_id', 'sequence']);
  });

  await knex.schema.createTable('payable_outbox_events', (table) => {
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

  await knex.schema.createTable('payable_webhook_endpoints', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('url').notNullable();
    table.text('events').notNullable();
    table.string('secret').nullable();
    table.string('status').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
  });

  await knex.schema.createTable('payable_webhook_deliveries', (table) => {
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

export async function createLegacyLedgerDatabase(knex: Knex): Promise<void> {
  await createLegacyBillingTables(knex);
  await createLegacySystemTables(knex);
  await knex.schema.createTable('payable_migrations', (table) => {
    table.string('name').primary();
    table.timestamp('applied_at', { useTz: true }).notNullable();
  });
  const appliedAt = new Date().toISOString();
  await knex('payable_migrations').insert(
    ['001-billing-tables', '002-system-tables', '003-alter-existing-tables'].map((name) => ({
      name,
      applied_at: appliedAt,
    })),
  );
}
