import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const TENANT = 'tenant-invoices';

describe('canonical local invoices', () => {
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

  it('creates and retrieves a providerless invoice with stable empty relationships', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'invoice-customer',
      email: 'invoice@example.test',
    });

    const invoice = await payable.canonicalInvoices(TENANT).create({
      customerId: customer.id,
      subscriptionId: null,
      status: 'open',
      currency: 'EUR',
      total: 4900,
      amountPaid: 0,
      amountDue: 4900,
      number: 'INV-100',
      hostedInvoiceUrl: null,
      invoicePdf: null,
    });

    expect(invoice).toMatchObject({ tenantId: TENANT, customerId: customer.id, number: 'INV-100' });
    await expect(payable.canonicalInvoices(TENANT).retrieve(invoice.id)).resolves.toEqual({
      ...invoice,
      bindings: [],
      paymentIds: [],
    });
    await expect(
      payable.canonicalInvoices(TENANT).transition(invoice.id, 'paid'),
    ).resolves.toMatchObject({
      id: invoice.id,
      status: 'paid',
    });
    await expect(
      payable.canonicalInvoices(TENANT).transition(invoice.id, 'open'),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('rejects terminal failure states as local creation states', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'invalid-state-customer',
      email: 'invalid-state@example.test',
    });

    await expect(
      payable.canonicalInvoices(TENANT).create({
        customerId: customer.id,
        status: 'void',
        currency: 'EUR',
        total: 100,
        amountPaid: 0,
        amountDue: 100,
      }),
    ).rejects.toMatchObject({ code: 'INVOICE_INITIAL_STATUS_INVALID' });
  });

  it('attaches provider identities and multiple payments explicitly', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'bound-customer',
      email: 'bound@example.test',
    });
    const invoice = await payable.canonicalInvoices(TENANT).create({
      customerId: customer.id,
      status: 'open',
      currency: 'EUR',
      total: 4900,
      amountPaid: 0,
      amountDue: 4900,
    });
    const payments = await Promise.all(
      ['one', 'two'].map((suffix) =>
        storage.payments.create({
          tenantId: TENANT,
          customerId: customer.id,
          provider: 'manual',
          providerPaymentId: null,
          status: 'succeeded',
          currency: 'EUR',
          amount: 2450,
          refundedAmount: 0,
          reference: `transfer-${suffix}`,
          description: null,
        }),
      ),
    );
    const firstPayment = payments[0];
    const secondPayment = payments[1];
    if (!firstPayment || !secondPayment) throw new Error('Expected two payments');

    const binding = await payable.canonicalInvoices(TENANT).attachProvider(invoice.id, {
      provider: 'stripe-primary',
      providerResourceType: 'invoice',
      providerResourceId: 'in_100',
    });
    await payable.canonicalInvoices(TENANT).attachPayment(invoice.id, firstPayment.id);
    await payable.canonicalInvoices(TENANT).attachPayment(invoice.id, firstPayment.id);
    await payable.canonicalInvoices(TENANT).attachPayment(invoice.id, secondPayment.id);

    await expect(payable.canonicalInvoices(TENANT).retrieve(invoice.id)).resolves.toEqual({
      ...invoice,
      bindings: [binding],
      paymentIds: expect.arrayContaining(payments.map(({ id }) => id)),
    });
    await payable.canonicalInvoices(TENANT).detachPayment(invoice.id, firstPayment.id);
    await payable.canonicalInvoices(TENANT).detachPayment(invoice.id, firstPayment.id);
    await expect(payable.canonicalInvoices(TENANT).retrieve(invoice.id)).resolves.toMatchObject({
      paymentIds: [secondPayment.id],
    });
  });

  it('converges concurrent provider binding retries to one identity', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'concurrent-binding-customer',
      email: 'concurrent-binding@example.test',
    });
    const invoice = await payable.canonicalInvoices(TENANT).create({
      customerId: customer.id,
      status: 'open',
      currency: 'EUR',
      total: 100,
      amountPaid: 0,
      amountDue: 100,
    });
    const input = {
      provider: 'stripe',
      providerResourceType: 'invoice',
      providerResourceId: 'in_concurrent',
    };

    const bindings = await Promise.all([
      payable.canonicalInvoices(TENANT).attachProvider(invoice.id, input),
      payable.canonicalInvoices(TENANT).attachProvider(invoice.id, input),
    ]);

    expect(new Set(bindings.map(({ id }) => id))).toHaveLength(1);
  });

  it('paginates inside a tenant and rejects cross-tenant relationships', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'page-customer',
      email: 'page@example.test',
    });
    const otherCustomer = await payable.customers(undefined, 'other-tenant').create({
      billableType: 'User',
      billableId: 'other-customer',
      email: 'other@example.test',
    });
    const invoices = [];
    for (const number of ['INV-1', 'INV-2', 'INV-3']) {
      invoices.push(
        await payable.canonicalInvoices(TENANT).create({
          customerId: customer.id,
          status: 'open',
          currency: 'EUR',
          total: 100,
          amountPaid: 0,
          amountDue: 100,
          number,
        }),
      );
    }
    const foreignPayment = await storage.payments.create({
      tenantId: 'other-tenant',
      customerId: otherCustomer.id,
      provider: 'manual',
      providerPaymentId: null,
      status: 'succeeded',
      currency: 'EUR',
      amount: 100,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const first = await payable.canonicalInvoices(TENANT).list({ limit: 2 });
    const second = await payable.canonicalInvoices(TENANT).list({
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect([...first.items, ...second.items]).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    const firstInvoice = invoices[0];
    if (!firstInvoice) throw new Error('Expected an invoice');
    await expect(
      payable.canonicalInvoices(TENANT).attachPayment(firstInvoice.id, foreignPayment.id),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });

  it('enforces payment tenant ownership at storage and database boundaries', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'storage-boundary-customer',
      email: 'storage-boundary@example.test',
    });
    const invoice = await payable.canonicalInvoices(TENANT).create({
      customerId: customer.id,
      status: 'open',
      currency: 'EUR',
      total: 100,
      amountPaid: 0,
      amountDue: 100,
    });
    const foreignPayment = await storage.payments.create({
      tenantId: 'other-tenant',
      customerId: null,
      provider: 'manual',
      providerPaymentId: null,
      status: 'succeeded',
      currency: 'EUR',
      amount: 100,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    await expect(
      storage.invoicePayments.attach({
        tenantId: TENANT,
        invoiceId: invoice.id,
        paymentId: foreignPayment.id,
        createdAt: new Date('2026-08-12T00:00:00Z'),
      }),
    ).rejects.toThrow('Payment not found for invoice tenant');

    await expect(
      database('payable_invoice_payments').insert({
        tenant_id: TENANT,
        tenant_key: TENANT,
        invoice_id: invoice.id,
        payment_id: foreignPayment.id,
        created_at: new Date('2026-08-12T00:00:00Z').toISOString(),
      }),
    ).rejects.toThrow();
  });
});
