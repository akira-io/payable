import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';

const databases: Knex[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

describe('provider-neutral collection page indexes', () => {
  it.each([
    ['payable_customers', 'payable_customers_tenant_page_index'],
    ['payable_canonical_products', 'payable_canonical_products_page_index'],
    ['payable_canonical_prices', 'payable_canonical_prices_tenant_page_index'],
    ['payable_subscriptions', 'payable_subscriptions_tenant_page_index'],
    ['payable_payments', 'payable_payments_tenant_page_index'],
  ])('creates the tenant keyset index for %s', async (_table, indexName) => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);

    const index = await database('sqlite_master')
      .where({ type: 'index', name: indexName })
      .first('name');

    expect(index).toEqual({ name: indexName });
  });

  it('backfills payment tenant keys before creating the page index', async () => {
    const database = createTestDb();
    databases.push(database);
    await createLegacyPaymentsTable(database);
    await database('payable_payments').insert({
      id: 'pay_legacy',
      tenant_id: 'tenant-a',
      customer_id: null,
      provider: 'manual',
      provider_payment_id: null,
      status: 'pending',
      currency: 'EUR',
      amount: 1000,
      refunded_amount: 0,
      reference: null,
      description: null,
      created_at: '2026-08-08T10:00:00.000Z',
      updated_at: '2026-08-08T10:00:00.000Z',
    });

    await migrate(database);

    await expect(
      database('payable_payments').where({ id: 'pay_legacy' }).first('tenant_key'),
    ).resolves.toEqual({ tenant_key: 'tenant-a' });
    await expect(
      database('payable_payments').where({ id: 'pay_legacy' }).update({ tenant_key: '' }),
    ).rejects.toThrow();
  });
});

async function createLegacyPaymentsTable(database: Knex): Promise<void> {
  await database.schema.createTable('payable_payments', (table) => {
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
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
  });
}
