import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomerProviderBindingsTable } from '../src/infrastructure/storage/knex/migrations/billing-schema';
import { addCustomerProviderBindings } from '../src/infrastructure/storage/knex/migrations/customer-provider-bindings';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';
import { createLegacyLedgerDatabase } from './support/legacy-ledger-schema';

let db: Knex;

beforeEach(() => {
  db = createTestDb();
});

afterEach(async () => {
  await db.destroy();
});

describe('customer provider binding migration', () => {
  it('moves beta3 provider ids into bindings without breaking customer relations', async () => {
    await createLegacyLedgerDatabase(db);
    const now = new Date('2026-07-31T00:00:00.000Z').toISOString();
    await db('payable_customers').insert([
      {
        id: 'customer-beta3',
        tenant_id: 'tenant-a',
        provider: 'stripe-eu',
        provider_customer_id: 'cus_beta3',
        billable_type: 'User',
        billable_id: '1',
        email: 'user@example.test',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'customer-local',
        tenant_id: 'tenant-a',
        provider: 'sisp',
        provider_customer_id: null,
        billable_type: 'User',
        billable_id: '2',
        email: 'local@example.test',
        created_at: now,
        updated_at: now,
      },
    ]);
    await db('payable_payments').insert({
      id: 'payment-beta3',
      tenant_id: 'tenant-a',
      customer_id: 'customer-beta3',
      provider: 'stripe-eu',
      provider_payment_id: 'pi_beta3',
      status: 'succeeded',
      currency: 'USD',
      amount: 1000,
      refunded_amount: 0,
      created_at: now,
      updated_at: now,
    });

    await migrate(db);

    expect(await db.schema.hasColumn('payable_customers', 'provider')).toBe(false);
    expect(await db.schema.hasColumn('payable_customers', 'provider_customer_id')).toBe(false);
    expect(
      (await db('payable_customers').where({ id: 'customer-beta3' }).first())?.tenant_key,
    ).toBe('tenant-a');
    expect(
      await db('payable_customer_provider_bindings')
        .where({ customer_id: 'customer-beta3', provider: 'stripe-eu' })
        .first(),
    ).toMatchObject({ provider_customer_id: 'cus_beta3' });
    expect(
      await db('payable_customer_provider_bindings')
        .where({ customer_id: 'customer-local' })
        .first(),
    ).toBeUndefined();
    expect(
      await db('payable_payments').where({ customer_id: 'customer-beta3' }).first(),
    ).toMatchObject({ id: 'payment-beta3' });
  });

  it('backfills a dataset larger than one bounded insert batch', async () => {
    await createLegacyLedgerDatabase(db);
    const now = new Date('2026-07-31T00:00:00.000Z').toISOString();
    await db('payable_customers').insert(
      Array.from({ length: 205 }, (_, index) => ({
        id: `customer-${index.toString().padStart(3, '0')}`,
        tenant_id: 'tenant-a',
        provider: 'stripe',
        provider_customer_id: `cus_${index}`,
        billable_type: 'User',
        billable_id: `${index}`,
        email: `user-${index}@example.test`,
        created_at: now,
        updated_at: now,
      })),
    );

    await migrate(db);

    const [countRow] = (await db('payable_customer_provider_bindings').count({ count: '*' })) as {
      count: number;
    }[];
    expect(Number(countRow?.count)).toBe(205);
  });

  it('resumes when provider_customer_id was dropped before the ledger write', async () => {
    await createLegacyLedgerDatabase(db);
    await db.schema.alterTable('payable_customers', (table) => {
      table.dropColumn('provider_customer_id');
    });

    await addCustomerProviderBindings(db);

    expect(await db.schema.hasColumn('payable_customers', 'provider')).toBe(false);
    expect(await db.schema.hasColumn('payable_customers', 'provider_customer_id')).toBe(false);
  });

  it('fails closed when a provider id remains without its provider key', async () => {
    await createLegacyLedgerDatabase(db);
    const now = new Date('2026-07-31T00:00:00.000Z').toISOString();
    await db('payable_customers').insert({
      id: 'customer-unbound',
      tenant_id: null,
      provider: 'stripe',
      provider_customer_id: 'cus_unbound',
      billable_type: 'User',
      billable_id: 'unbound',
      email: 'unbound@example.test',
      created_at: now,
      updated_at: now,
    });
    await db.schema.alterTable('payable_customers', (table) => {
      table.dropColumn('provider');
    });

    await expect(addCustomerProviderBindings(db)).rejects.toThrow('before binding customer');
    expect(await db.schema.hasColumn('payable_customers', 'provider_customer_id')).toBe(true);
  });

  it('resumes after provider was dropped when every provider id was already bound', async () => {
    await createLegacyLedgerDatabase(db);
    await createCustomerProviderBindingsTable(db);
    const now = new Date('2026-07-31T00:00:00.000Z').toISOString();
    await db('payable_customers').insert({
      id: 'customer-bound',
      tenant_id: null,
      provider: 'stripe',
      provider_customer_id: 'cus_bound',
      billable_type: 'User',
      billable_id: 'bound',
      email: 'bound@example.test',
      created_at: now,
      updated_at: now,
    });
    await db('payable_customer_provider_bindings').insert({
      id: 'binding-bound',
      customer_id: 'customer-bound',
      provider: 'stripe',
      provider_customer_id: 'cus_bound',
      created_at: now,
      updated_at: now,
    });
    await db.schema.alterTable('payable_customers', (table) => {
      table.dropColumn('provider');
    });

    await addCustomerProviderBindings(db);

    expect(await db.schema.hasColumn('payable_customers', 'provider_customer_id')).toBe(false);
  });
});
