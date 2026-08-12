import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCanonicalInvoices } from '../src/infrastructure/storage/knex/migrations/canonical-invoices';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';
import { createLegacyLedgerDatabase } from './support/legacy-ledger-schema';

describe('canonical invoice migration', () => {
  let database: Knex;

  beforeEach(async () => {
    database = createTestDb();
    await createLegacyLedgerDatabase(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('preserves legacy invoices and creates explicit provider bindings', async () => {
    await insertLegacyCustomer(database, 'legacy-customer');
    await insertLegacyInvoice(database, 'legacy-bound', 'stripe', 'in_legacy');

    const report = await addCanonicalInvoices(database);

    expect(report).toEqual({
      invoicesBackfilled: 1,
      bindingsBackfilled: 1,
      unresolvedProviderRows: 0,
      orphanedCustomerRows: 0,
      orphanedSubscriptionRows: 0,
      unmappedInvoiceRows: 0,
      conflictingProviderRows: 0,
      subscriptionCustomerMismatchRows: 0,
    });
    await expect(
      database('payable_canonical_invoices').where({ id: 'legacy-bound' }).first(),
    ).resolves.toMatchObject({ id: 'legacy-bound', total: 4900, amount_due: 4900 });
    await expect(
      database('payable_invoice_provider_bindings').where({ invoice_id: 'legacy-bound' }).first(),
    ).resolves.toMatchObject({ provider: 'stripe', provider_resource_id: 'in_legacy' });
  });

  it('reports incomplete provider identities without inventing a binding', async () => {
    await insertLegacyCustomer(database, 'legacy-customer');
    await insertLegacyInvoice(database, 'legacy-unresolved', 'manual', null);

    const first = await addCanonicalInvoices(database);
    const second = await addCanonicalInvoices(database);

    expect(first.unresolvedProviderRows).toBe(1);
    expect(second).toEqual({
      invoicesBackfilled: 0,
      bindingsBackfilled: 0,
      unresolvedProviderRows: 1,
      orphanedCustomerRows: 0,
      orphanedSubscriptionRows: 0,
      unmappedInvoiceRows: 0,
      conflictingProviderRows: 0,
      subscriptionCustomerMismatchRows: 0,
    });
    expect(
      await database('payable_invoice_provider_bindings').count({ count: '*' }).first(),
    ).toMatchObject({ count: 0 });
  });

  it('does not canonicalize an invoice whose customer relationship is unproven', async () => {
    await insertLegacyInvoice(database, 'legacy-orphan', 'stripe', 'in_orphan');

    const report = await addCanonicalInvoices(database);

    expect(report.orphanedCustomerRows).toBe(1);
    expect(report.unmappedInvoiceRows).toBe(1);
    await expect(
      database('payable_canonical_invoices').where({ id: 'legacy-orphan' }).first(),
    ).resolves.toBeUndefined();
  });

  it('reports a provider-resource conflict without aborting the migration', async () => {
    await insertLegacyCustomer(database, 'legacy-customer');
    await insertLegacyInvoice(database, 'legacy-first', 'stripe', 'in_shared');
    await addCanonicalInvoices(database);
    await database('payable_invoices').where({ id: 'legacy-first' }).delete();
    await insertLegacyInvoice(database, 'legacy-second', 'stripe', 'in_shared');

    const report = await addCanonicalInvoices(database);

    expect(report.conflictingProviderRows).toBe(1);
    expect(report.bindingsBackfilled).toBe(0);
    await expect(
      database('payable_canonical_invoices').where({ id: 'legacy-second' }).first(),
    ).resolves.toMatchObject({ id: 'legacy-second' });
  });

  it('reports a conflicting existing invoice-provider binding without replacing it', async () => {
    await insertLegacyCustomer(database, 'legacy-customer');
    await insertLegacyInvoice(database, 'legacy-bound', 'stripe', 'in_original');
    await addCanonicalInvoices(database);
    await database('payable_invoices').where({ id: 'legacy-bound' }).update({
      provider_invoice_id: 'in_rewritten',
    });

    const report = await addCanonicalInvoices(database);

    expect(report).toMatchObject({ bindingsBackfilled: 0, conflictingProviderRows: 1 });
    await expect(
      database('payable_invoice_provider_bindings')
        .where({ invoice_id: 'legacy-bound', provider: 'stripe' })
        .first(),
    ).resolves.toMatchObject({ provider_resource_id: 'in_original' });
  });

  it('records Paddle legacy identities as transaction resources', async () => {
    await insertLegacyCustomer(database, 'legacy-customer');
    await insertLegacyInvoice(database, 'legacy-paddle', 'PADDLE', 'txn_legacy');

    await addCanonicalInvoices(database);

    await expect(
      database('payable_invoice_provider_bindings').where({ invoice_id: 'legacy-paddle' }).first(),
    ).resolves.toMatchObject({ provider_resource_type: 'transaction' });
  });

  it('leaves a subscription unmapped when it belongs to another customer', async () => {
    await insertLegacyCustomer(database, 'legacy-customer');
    await insertLegacyCustomer(database, 'subscription-customer');
    await insertLegacySubscription(database, 'legacy-subscription', 'subscription-customer');
    await insertLegacyInvoice(database, 'legacy-mismatch', 'stripe', 'in_mismatch');
    await database('payable_invoices').where({ id: 'legacy-mismatch' }).update({
      subscription_id: 'legacy-subscription',
    });

    const report = await addCanonicalInvoices(database);

    expect(report.subscriptionCustomerMismatchRows).toBe(1);
    await expect(
      database('payable_canonical_invoices').where({ id: 'legacy-mismatch' }).first(),
    ).resolves.toMatchObject({ subscription_id: null });
  });

  it('persists the step 020 report through the production migration path', async () => {
    await insertLegacyCustomer(database, 'legacy-customer');
    await insertLegacyInvoice(database, 'legacy-unresolved', 'manual', null);

    await migrate(database);

    const stored = await database('payable_migration_reports')
      .where({ migration_name: '020-canonical-invoices' })
      .first();
    expect(JSON.parse(stored.report as string)).toMatchObject({
      invoicesBackfilled: 1,
      unresolvedProviderRows: 1,
    });
  });
});

async function insertLegacyCustomer(database: Knex, id: string): Promise<void> {
  const timestamp = new Date('2026-08-01T00:00:00Z').toISOString();
  await database('payable_customers').insert({
    id,
    tenant_id: null,
    provider: 'stripe',
    provider_customer_id: `cus_${id}`,
    billable_type: 'Account',
    billable_id: id,
    email: `${id}@example.com`,
    name: null,
    metadata: null,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

async function insertLegacyInvoice(
  database: Knex,
  id: string,
  provider: string,
  providerInvoiceId: string | null,
): Promise<void> {
  const timestamp = new Date('2026-08-01T00:00:00Z').toISOString();
  await database('payable_invoices').insert({
    id,
    tenant_id: null,
    customer_id: 'legacy-customer',
    subscription_id: null,
    provider,
    provider_invoice_id: providerInvoiceId,
    status: 'open',
    currency: 'EUR',
    total: 4900,
    amount_paid: 0,
    amount_due: 4900,
    number: 'INV-LEGACY',
    hosted_invoice_url: null,
    invoice_pdf: null,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

async function insertLegacySubscription(
  database: Knex,
  id: string,
  customerId: string,
): Promise<void> {
  const timestamp = new Date('2026-08-01T00:00:00Z').toISOString();
  await database('payable_subscriptions').insert({
    id,
    tenant_id: null,
    customer_id: customerId,
    name: id,
    provider: 'stripe',
    provider_subscription_id: `sub_${id}`,
    status: 'active',
    price_id: null,
    quantity: 1,
    trial_ends_at: null,
    ends_at: null,
    current_period_start: null,
    current_period_end: null,
    created_at: timestamp,
    updated_at: timestamp,
  });
}
