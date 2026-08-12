import type { Knex } from 'knex';
import { createIfMissing } from './create-if-missing';

export interface CanonicalInvoiceMigrationReport {
  invoicesBackfilled: number;
  bindingsBackfilled: number;
  unresolvedProviderRows: number;
  orphanedCustomerRows: number;
  orphanedSubscriptionRows: number;
  unmappedInvoiceRows: number;
  conflictingProviderRows: number;
  subscriptionCustomerMismatchRows: number;
}

export async function addCanonicalInvoices(knex: Knex): Promise<CanonicalInvoiceMigrationReport> {
  await createCanonicalInvoiceTables(knex);
  const report = await backfillLegacyInvoices(knex);
  await persistMigrationReport(knex, report);
  return report;
}

async function createCanonicalInvoiceTables(knex: Knex): Promise<void> {
  await createIfMissing(knex, 'payable_canonical_invoices', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('customer_id').notNullable();
    table.uuid('subscription_id').nullable();
    table.string('status').notNullable();
    table.string('currency').notNullable();
    table.bigInteger('total').notNullable();
    table.bigInteger('amount_paid').notNullable();
    table.bigInteger('amount_due').notNullable();
    table.string('number').nullable();
    table.text('hosted_invoice_url').nullable();
    table.text('invoice_pdf').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.unique(['tenant_key', 'id'], {
      indexName: 'payable_canonical_invoices_tenant_id_unique',
    });
    table.index(['tenant_key', 'created_at', 'id'], 'payable_canonical_invoices_page_index');
    table.index(
      ['tenant_key', 'customer_id', 'created_at', 'id'],
      'payable_canonical_invoices_customer_page_index',
    );
  });
  await createIfMissing(knex, 'payable_invoice_provider_bindings', (table) => {
    table.uuid('id').primary();
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('invoice_id').notNullable();
    table.string('provider').notNullable();
    table.string('provider_resource_type').notNullable();
    table.string('provider_resource_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table
      .foreign(['tenant_key', 'invoice_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_canonical_invoices')
      .onDelete('CASCADE');
    table.unique(['tenant_key', 'invoice_id', 'provider'], {
      indexName: 'payable_invoice_bindings_invoice_provider_unique',
    });
    table.unique(['tenant_key', 'provider', 'provider_resource_type', 'provider_resource_id'], {
      indexName: 'payable_invoice_bindings_provider_resource_unique',
    });
  });
  await createIfMissing(knex, 'payable_invoice_payments', (table) => {
    table.string('tenant_id').nullable();
    table.string('tenant_key').notNullable().defaultTo('');
    table.uuid('invoice_id').notNullable();
    table.uuid('payment_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table
      .foreign(['tenant_key', 'invoice_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_canonical_invoices')
      .onDelete('CASCADE');
    table
      .foreign(['tenant_key', 'payment_id'])
      .references(['tenant_key', 'id'])
      .inTable('payable_payments')
      .onDelete('RESTRICT');
    table.unique(['tenant_key', 'invoice_id', 'payment_id'], {
      indexName: 'payable_invoice_payments_unique',
    });
    table.index(
      ['tenant_key', 'invoice_id', 'created_at', 'payment_id'],
      'payable_invoice_payments_page_index',
    );
  });
  await createIfMissing(knex, 'payable_migration_reports', (table) => {
    table.string('migration_name').primary();
    table.text('report').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
  });
}

async function backfillLegacyInvoices(knex: Knex): Promise<CanonicalInvoiceMigrationReport> {
  if (!(await knex.schema.hasTable('payable_invoices'))) {
    return {
      invoicesBackfilled: 0,
      bindingsBackfilled: 0,
      unresolvedProviderRows: 0,
      orphanedCustomerRows: 0,
      orphanedSubscriptionRows: 0,
      unmappedInvoiceRows: 0,
      conflictingProviderRows: 0,
      subscriptionCustomerMismatchRows: 0,
    };
  }
  const legacy = (await knex('payable_invoices').select('*')) as Record<string, unknown>[];
  let invoicesBackfilled = 0;
  let bindingsBackfilled = 0;
  let unresolvedProviderRows = 0;
  let orphanedCustomerRows = 0;
  let orphanedSubscriptionRows = 0;
  let unmappedInvoiceRows = 0;
  let conflictingProviderRows = 0;
  let subscriptionCustomerMismatchRows = 0;
  for (const row of legacy) {
    const tenantId = (row.tenant_id as string | null) ?? null;
    const customer = await knex('payable_customers')
      .where({ id: row.customer_id, tenant_id: tenantId })
      .first();
    if (!customer) {
      orphanedCustomerRows += 1;
      unmappedInvoiceRows += 1;
      continue;
    }
    let subscriptionId = row.subscription_id as string | null;
    if (row.subscription_id) {
      const subscription = await knex('payable_subscriptions')
        .where({ id: row.subscription_id, tenant_id: tenantId })
        .first();
      if (!subscription) {
        orphanedSubscriptionRows += 1;
        subscriptionId = null;
      }
      if (subscription && subscription.customer_id !== row.customer_id) {
        subscriptionCustomerMismatchRows += 1;
        subscriptionId = null;
      }
    }
    const existingInvoice = await knex('payable_canonical_invoices').where({ id: row.id }).first();
    await knex('payable_canonical_invoices')
      .insert({
        id: row.id,
        tenant_id: tenantId,
        tenant_key: tenantId ?? '',
        customer_id: row.customer_id,
        subscription_id: subscriptionId,
        status: row.status,
        currency: row.currency,
        total: row.total,
        amount_paid: row.amount_paid,
        amount_due: row.amount_due,
        number: row.number,
        hosted_invoice_url: row.hosted_invoice_url,
        invoice_pdf: row.invoice_pdf,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })
      .onConflict('id')
      .ignore();
    if (!existingInvoice) invoicesBackfilled += 1;
    const provider = row.provider as string | null;
    const providerInvoiceId = row.provider_invoice_id as string | null;
    if (!provider || !providerInvoiceId) {
      unresolvedProviderRows += 1;
      continue;
    }
    const existingBinding = await knex('payable_invoice_provider_bindings')
      .where({ tenant_key: tenantId ?? '', invoice_id: row.id, provider })
      .first();
    const providerResourceType = legacyProviderResourceType(provider);
    if (
      existingBinding &&
      (existingBinding.provider_resource_type !== providerResourceType ||
        existingBinding.provider_resource_id !== providerInvoiceId)
    ) {
      conflictingProviderRows += 1;
      continue;
    }
    const conflictingBinding = await knex('payable_invoice_provider_bindings')
      .where({
        tenant_key: tenantId ?? '',
        provider,
        provider_resource_type: providerResourceType,
        provider_resource_id: providerInvoiceId,
      })
      .whereNot({ invoice_id: row.id })
      .first();
    if (conflictingBinding) {
      conflictingProviderRows += 1;
      continue;
    }
    await knex('payable_invoice_provider_bindings')
      .insert({
        id: globalThis.crypto.randomUUID(),
        tenant_id: tenantId,
        tenant_key: tenantId ?? '',
        invoice_id: row.id,
        provider,
        provider_resource_type: providerResourceType,
        provider_resource_id: providerInvoiceId,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })
      .onConflict(['tenant_key', 'invoice_id', 'provider'])
      .ignore();
    if (!existingBinding) bindingsBackfilled += 1;
  }
  return {
    invoicesBackfilled,
    bindingsBackfilled,
    unresolvedProviderRows,
    orphanedCustomerRows,
    orphanedSubscriptionRows,
    unmappedInvoiceRows,
    conflictingProviderRows,
    subscriptionCustomerMismatchRows,
  };
}

async function persistMigrationReport(
  knex: Knex,
  report: CanonicalInvoiceMigrationReport,
): Promise<void> {
  const timestamp = new Date().toISOString();
  await knex('payable_migration_reports')
    .insert({
      migration_name: '020-canonical-invoices',
      report: JSON.stringify(report),
      created_at: timestamp,
      updated_at: timestamp,
    })
    .onConflict('migration_name')
    .merge({ report: JSON.stringify(report), updated_at: timestamp });
}

function legacyProviderResourceType(provider: string): string {
  return provider.toLowerCase() === 'paddle' ? 'transaction' : 'invoice';
}
