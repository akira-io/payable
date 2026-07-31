import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

function makeApp(payable: Payable): express.Express {
  const app = express();
  app.use('/payable', createExpressPayableRoutes(payable));
  return app;
}

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('express adapter', () => {
  it('lists invoices and payments for a billable', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const app = makeApp(payable);

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

    const invoices = await request(app)
      .get('/payable/invoices')
      .query({ billableType: 'User', billableId: '1' });
    expect(invoices.status).toBe(200);
    expect(invoices.body[0]?.providerInvoiceId).toBe('in_fake');

    const payments = await request(app)
      .get('/payable/payments')
      .query({ billableType: 'User', billableId: '1' });
    expect(payments.status).toBe(200);
    expect(payments.body).toHaveLength(1);
    await db.destroy();
  });

  it('creates, reads, and updates a customer over HTTP', async () => {
    const db = createTestDb();
    await migrate(db);
    const app = makeApp(
      createPayable({
        providers: { stripe: new FakeProvider() },
        storage: new KnexStorageDriver(db, new FakeClock()),
      }),
    );

    const missing = await request(app)
      .get('/payable/customers')
      .query({ billableType: 'User', billableId: '1' });
    expect(missing.status).toBe(404);

    const created = await request(app).post('/payable/customers').send({ billable });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      billableType: 'User',
      billableId: '1',
      email: 'user@example.com',
    });

    const fetched = await request(app)
      .get('/payable/customers')
      .query({ billableType: 'User', billableId: '1' });
    expect(fetched.status).toBe(200);
    expect(fetched.body.email).toBe('user@example.com');

    const updated = await request(app)
      .patch('/payable/customers')
      .send({ billable, name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Renamed');
    await db.destroy();
  });

  it('creates products and prices over HTTP', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));

    const product = await request(app).post('/payable/products').send({ name: 'Pro' });
    expect(product.status).toBe(201);
    expect(product.body.providerProductId).toBe('prod_fake');

    const price = await request(app)
      .post('/payable/prices')
      .send({
        providerProductId: 'prod_fake',
        amount: { amount: 9900, currency: 'USD' },
        interval: 'month',
      });
    expect(price.status).toBe(201);
    expect(price.body.providerPriceId).toBe('price_fake');
  });
});
