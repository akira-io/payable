import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

async function makeApp(
  payable: Payable,
  options: Parameters<typeof createFastifyPayablePlugin>[1] = {},
) {
  const app = Fastify();
  await app.register(createFastifyPayablePlugin(payable, options), { prefix: '/payable' });
  await app.ready();
  return app;
}

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('fastify adapter', () => {
  it('lists invoices and payments for a billable', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const app = await makeApp(payable);

    const customer = await payable.customers().create(billable);
    await storage.payments.create({
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      providerPaymentId: 'pi_list',
      status: 'succeeded',
      currency: 'USD',
      amount: 9900,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const invoices = await app.inject({
      method: 'GET',
      url: '/payable/invoices',
      query: { billableType: 'User', billableId: '1' },
    });
    expect(invoices.statusCode).toBe(200);
    expect(invoices.json()[0]?.providerInvoiceId).toBe('in_fake');

    const payments = await app.inject({
      method: 'GET',
      url: '/payable/payments',
      query: { billableType: 'User', billableId: '1' },
    });
    expect(payments.statusCode).toBe(200);
    expect(payments.json()).toHaveLength(1);
    await app.close();
    await db.destroy();
  });

  it('refunds a payment over HTTP', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_fastify',
      status: 'succeeded',
      currency: 'USD',
      amount: 4000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    const app = await makeApp(
      createPayable({ providers: { stripe: new FakeProvider() }, storage }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/payable/refunds',
      payload: { paymentId: payment.id, amount: { amount: 4000, currency: 'USD' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ amount: 4000 });

    const missing = await app.inject({ method: 'POST', url: '/payable/refunds', payload: {} });
    expect(missing.statusCode).toBe(422);

    const badCurrency = await app.inject({
      method: 'POST',
      url: '/payable/refunds',
      payload: { paymentId: payment.id, amount: { amount: 100, currency: 'NOPE' } },
    });
    expect(badCurrency.statusCode).toBe(422);
    expect(badCurrency.json().error).toBe('VALIDATION_FAILED');
    await app.close();
    await db.destroy();
  });

  it('creates, reads, and updates a customer over HTTP', async () => {
    const db = createTestDb();
    await migrate(db);
    const app = await makeApp(
      createPayable({
        providers: { stripe: new FakeProvider() },
        storage: new KnexStorageDriver(db, new FakeClock()),
      }),
    );

    const missing = await app.inject({
      method: 'GET',
      url: '/payable/customers',
      query: { billableType: 'User', billableId: '1' },
    });
    expect(missing.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/payable/customers',
      payload: { billable },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      billableType: 'User',
      billableId: '1',
      email: 'user@example.com',
    });

    const updated = await app.inject({
      method: 'PATCH',
      url: '/payable/customers',
      payload: { billable, name: 'Renamed' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe('Renamed');
    await app.close();
    await db.destroy();
  });

  it('creates products and prices over HTTP', async () => {
    const app = await makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));

    const product = await app.inject({
      method: 'POST',
      url: '/payable/products',
      payload: { name: 'Pro' },
    });
    expect(product.statusCode).toBe(201);
    expect(product.json().providerProductId).toBe('prod_fake');

    const price = await app.inject({
      method: 'POST',
      url: '/payable/prices',
      payload: {
        providerProductId: 'prod_fake',
        amount: { amount: 9900, currency: 'USD' },
        interval: 'month',
      },
    });
    expect(price.statusCode).toBe(201);
    expect(price.json().providerPriceId).toBe('price_fake');
    await app.close();
  });
});
