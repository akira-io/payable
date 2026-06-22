import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

export async function createBillingTables(knex: Knex): Promise<void> {
  await createIfMissing(knex, 'payable_customers', (table) => {
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
    table.index(['tenant_id', 'billable_type', 'billable_id']);
  });

  await createIfMissing(knex, 'payable_products', (table) => {
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

  await createIfMissing(knex, 'payable_prices', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_price_id').nullable();
    table.uuid('product_id').notNullable();
    table.string('currency').notNullable();
    table.integer('unit_amount').notNullable();
    table.string('interval').nullable();
    table.integer('interval_count').nullable();
    table.boolean('active').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_price_id']);
    table.index('product_id');
  });

  await createIfMissing(knex, 'payable_subscriptions', (table) => {
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

  await createIfMissing(knex, 'payable_subscription_items', (table) => {
    table.uuid('id').primary();
    table.uuid('subscription_id').notNullable();
    table.uuid('price_id').notNullable();
    table.string('provider_item_id').nullable();
    table.integer('quantity').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.index('subscription_id');
  });

  await createIfMissing(knex, 'payable_invoices', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('customer_id').notNullable();
    table.uuid('subscription_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_invoice_id').nullable();
    table.string('status').notNullable();
    table.string('currency').notNullable();
    table.integer('total').notNullable();
    table.integer('amount_paid').notNullable();
    table.integer('amount_due').notNullable();
    table.string('number').nullable();
    table.text('hosted_invoice_url').nullable();
    table.text('invoice_pdf').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_invoice_id']);
    table.index('customer_id');
  });

  await createIfMissing(knex, 'payable_payments', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('customer_id').nullable();
    table.string('provider').notNullable();
    table.string('provider_payment_id').nullable();
    table.string('status').notNullable();
    table.string('currency').notNullable();
    table.integer('amount').notNullable();
    table.integer('refunded_amount').notNullable();
    table.string('reference').nullable();
    table.text('description').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_payment_id']);
    table.index('customer_id');
  });

  await createIfMissing(knex, 'payable_refunds', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.uuid('payment_id').notNullable();
    table.string('provider').notNullable();
    table.string('provider_refund_id').nullable();
    table.string('status').notNullable();
    table.string('currency').notNullable();
    table.integer('amount').notNullable();
    table.text('reason').nullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.unique(['provider', 'provider_refund_id']);
    table.index('payment_id');
  });
}
