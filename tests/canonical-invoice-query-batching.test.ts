import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const TENANT = 'tenant-invoice-batching';

describe('canonical invoice relationship loading', () => {
  let database: Knex;
  let storage: KnexStorageDriver;

  beforeEach(async () => {
    database = createTestDb();
    await migrate(database);
    storage = new KnexStorageDriver(database, new FakeClock(new Date('2026-08-12T00:00:00Z')));
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('loads page relationships with one query per relationship table', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'batch-customer',
      email: 'batch@example.test',
    });
    for (const number of ['INV-BATCH-1', 'INV-BATCH-2']) {
      await payable.canonicalInvoices(TENANT).create({
        customerId: customer.id,
        status: 'open',
        currency: 'EUR',
        total: 100,
        amountPaid: 0,
        amountDue: 100,
        number,
      });
    }
    const statements: string[] = [];
    const recordStatement = ({ sql }: { sql: string }) => statements.push(sql);
    database.on('query', recordStatement);

    await payable.canonicalInvoices(TENANT).list();

    database.off('query', recordStatement);
    expect(
      statements.filter((sql) => sql.includes('payable_invoice_provider_bindings')),
    ).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('payable_invoice_payments'))).toHaveLength(1);
  });

  it('normalizes a provider resource already bound to another invoice', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'binding-conflict-customer',
      email: 'binding-conflict@example.test',
    });
    const invoices = await Promise.all(
      ['INV-CONFLICT-1', 'INV-CONFLICT-2'].map((number) =>
        payable.canonicalInvoices(TENANT).create({
          customerId: customer.id,
          status: 'open',
          currency: 'EUR',
          total: 100,
          amountPaid: 0,
          amountDue: 100,
          number,
        }),
      ),
    );
    const firstInvoice = invoices[0];
    const secondInvoice = invoices[1];
    if (!firstInvoice || !secondInvoice) throw new Error('Expected two invoices');
    const binding = {
      provider: 'stripe',
      providerResourceType: 'invoice',
      providerResourceId: 'in_shared',
    };
    await payable.canonicalInvoices(TENANT).attachProvider(firstInvoice.id, binding);

    await expect(
      payable.canonicalInvoices(TENANT).attachProvider(secondInvoice.id, binding),
    ).rejects.toMatchObject({ code: 'INVOICE_PROVIDER_BINDING_CONFLICT' });
  });
});
