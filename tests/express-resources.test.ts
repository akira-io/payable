import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
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

  it('lists, retrieves, activates, and archives products over HTTP', async () => {
    const provider = new FakeProvider();
    provider.productsPage.nextCursor = 'prod_next';
    const payable = createPayable({
      providers: { stripe: provider },
      tenant: { enabled: true },
    });
    const app = express();
    app.use('/payable', createExpressPayableRoutes(payable, { resolveTenant: () => 'tenant-a' }));

    const listed = await request(app)
      .get('/payable/products')
      .query({ limit: 25, cursor: 'prod_cursor', active: false });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      data: [{ providerProductId: 'prod_fake', active: true }],
      nextCursor: 'prod_next',
    });
    expect(provider.lastListProducts).toEqual({
      limit: 25,
      cursor: 'prod_cursor',
      active: false,
    });

    const retrieved = await request(app).get('/payable/products/prod_fake');
    expect(retrieved.status).toBe(200);
    expect(retrieved.body).toMatchObject({ providerProductId: 'prod_fake', active: true });

    const activated = await request(app).post('/payable/products/prod_fake/activate');
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ providerProductId: 'prod_fake', active: true });

    const archived = await request(app).post('/payable/products/prod_fake/archive');
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ providerProductId: 'prod_fake', active: false });
    expect(provider.productActiveCalls.map(({ id, active }) => ({ id, active }))).toEqual([
      { id: 'prod_fake', active: true },
      { id: 'prod_fake', active: false },
    ]);
  });

  it('lists, retrieves, activates, and archives prices over HTTP', async () => {
    const provider = new FakeProvider();
    provider.pricesPage.nextCursor = 'price_next';
    const app = makeApp(createPayable({ providers: { stripe: provider } }));

    const listed = await request(app).get('/payable/prices').query({
      limit: 30,
      cursor: 'price_cursor',
      active: false,
      providerProductId: 'prod_fake',
    });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      data: [{ providerPriceId: 'price_fake', providerProductId: 'prod_fake', active: true }],
      nextCursor: 'price_next',
    });
    expect(provider.lastListPrices).toEqual({
      limit: 30,
      cursor: 'price_cursor',
      active: false,
      providerProductId: 'prod_fake',
    });

    const retrieved = await request(app).get('/payable/prices/price_fake');
    expect(retrieved.status).toBe(200);
    expect(retrieved.body).toMatchObject({ providerPriceId: 'price_fake', active: true });

    const activated = await request(app).post('/payable/prices/price_fake/activate');
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ providerPriceId: 'price_fake', active: true });

    const archived = await request(app).post('/payable/prices/price_fake/archive');
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ providerPriceId: 'price_fake', active: false });
    expect(provider.priceActiveCalls.map(({ id, active }) => ({ id, active }))).toEqual([
      { id: 'price_fake', active: true },
      { id: 'price_fake', active: false },
    ]);
  });

  it('denies catalog lifecycle requests before provider mutation', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      authorization: { enabled: true },
    });
    const app = express();
    app.use(
      '/payable',
      createExpressPayableRoutes(payable, {
        authenticate: (_req, _res, next) => next(),
        resolveAuthorization: () => ({ allowed: false, actorId: 'viewer' }),
      }),
    );

    for (const path of [
      '/payable/products/prod_fake/activate',
      '/payable/products/prod_fake/archive',
      '/payable/prices/price_fake/activate',
      '/payable/prices/price_fake/archive',
    ]) {
      const response = await request(app).post(path);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: 'AUTHORIZATION_DENIED' });
    }
    expect(provider.productActiveCalls).toEqual([]);
    expect(provider.priceActiveCalls).toEqual([]);
  });

  it('maps missing products and prices to 404 responses', async () => {
    const provider = new FakeProvider();
    provider.retrieveProduct = async () => {
      throw new PayableError('Product not found', { code: 'PRODUCT_NOT_FOUND' });
    };
    provider.retrievePrice = async () => {
      throw new PayableError('Price not found', { code: 'PRICE_NOT_FOUND' });
    };
    const app = makeApp(createPayable({ providers: { stripe: provider } }));

    const product = await request(app).get('/payable/products/prod_missing');
    expect(product.status).toBe(404);
    expect(product.body.error).toBe('PRODUCT_NOT_FOUND');

    const price = await request(app).get('/payable/prices/price_missing');
    expect(price.status).toBe(404);
    expect(price.body.error).toBe('PRICE_NOT_FOUND');
  });
});
