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
  it('refunds a payment over HTTP', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_http',
      status: 'succeeded',
      currency: 'USD',
      amount: 9900,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() }, storage }));

    const res = await request(app)
      .post('/payable/refunds')
      .send({ paymentId: payment.id, amount: { amount: 9900, currency: 'USD' } });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 9900 });

    const missing = await request(app).post('/payable/refunds').send({});
    expect(missing.status).toBe(422);
    expect(missing.body.error).toBe('VALIDATION_FAILED');
    await db.destroy();
  });

  it('lists subscriptions and refunds over HTTP', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const customer = await payable.customers().create(billable);
    await storage.subscriptions.create({
      tenantId: null,
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      priceId: 'price_pro',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      providerPaymentId: 'pi_r',
      status: 'succeeded',
      currency: 'USD',
      amount: 9900,
      refundedAmount: 4000,
      reference: null,
      description: null,
    });
    await storage.refunds.create({
      tenantId: null,
      paymentId: payment.id,
      provider: 'stripe',
      providerRefundId: 're_1',
      status: 'succeeded',
      currency: 'USD',
      amount: 4000,
      reason: null,
    });
    const app = makeApp(payable);

    const list = await request(app)
      .get('/payable/subscriptions')
      .query({ billableType: 'User', billableId: '1' });
    expect(list.status).toBe(200);
    expect(list.body[0]?.name).toBe('default');

    const one = await request(app)
      .get('/payable/subscriptions/default')
      .query({ billableType: 'User', billableId: '1' });
    expect(one.status).toBe(200);
    expect(one.body.status).toBe('active');

    const missingSub = await request(app)
      .get('/payable/subscriptions/nope')
      .query({ billableType: 'User', billableId: '1' });
    expect(missingSub.status).toBe(404);

    const refunds = await request(app).get('/payable/refunds').query({ paymentId: payment.id });
    expect(refunds.status).toBe(200);
    expect(refunds.body[0]?.amount).toBe(4000);
    await db.destroy();
  });

  it('downloads an invoice pdf over HTTP', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const customer = await payable.customers().create(billable);
    await storage.invoices.create({
      tenantId: null,
      customerId: customer.id,
      subscriptionId: null,
      provider: 'stripe',
      providerInvoiceId: 'in_fake',
      status: 'paid',
      currency: 'USD',
      total: 9900,
      amountPaid: 9900,
      amountDue: 0,
      number: null,
      hostedInvoiceUrl: null,
      invoicePdf: null,
    });
    const app = makeApp(payable);

    const res = await request(app).get(
      '/payable/invoices/in_fake/pdf?billableType=User&billableId=1',
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('in_fake.pdf');
    expect(Buffer.from(res.body)).toEqual(Buffer.from([1, 2, 3]));

    const otherCustomer = await request(app).get(
      '/payable/invoices/in_fake/pdf?billableType=User&billableId=2',
    );
    expect(otherCustomer.status).toBe(404);

    const missing = await request(app).get(
      '/payable/invoices/in_missing/pdf?billableType=User&billableId=1',
    );
    expect(missing.status).toBe(404);
    await db.destroy();
  });
});
