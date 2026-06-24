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
  it('creates a subscription checkout session', async () => {
    const provider = new FakeProvider();
    const app = makeApp(createPayable({ providers: { stripe: provider } }));

    const res = await request(app)
      .post('/payable/checkout')
      .send({
        billable,
        subscription: { name: 'default', price: 'price_pro', trialDays: 14 },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });
    expect(provider.lastCheckout?.input.trialDays).toBe(14);
  });

  it('threads a resolved tenant id so writes work under tenancy', async () => {
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      tenant: { enabled: true },
    });
    const app = express();
    app.use('/payable', createExpressPayableRoutes(payable, { resolveTenant: () => 'tenant-a' }));

    const res = await request(app)
      .post('/payable/checkout')
      .send({
        billable,
        subscription: { name: 'default', price: 'price_pro' },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      });
    expect(res.status).toBe(201);
  });

  it('returns 400 TENANT_REQUIRED when tenancy is on but no tenant is resolved', async () => {
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      tenant: { enabled: true },
    });
    const app = makeApp(payable);

    const res = await request(app)
      .post('/payable/checkout')
      .send({
        billable,
        subscription: { name: 'default', price: 'price_pro' },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TENANT_REQUIRED');
  });

  it('processes a webhook from the raw body', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_1',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const app = makeApp(createPayable({ providers: { stripe: provider }, storage }));

    const res = await request(app)
      .post('/payable/webhooks')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_1"}');

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(false);
    expect(provider.lastVerifyInput?.payload).toBe('{"id":"evt_1"}');
    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1'))?.status).toBe(
      'processed',
    );
    await db.destroy();
  });

  it('runs the authenticate hook on state-changing routes but not on webhooks', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_auth',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const app = express();
    app.use(
      '/payable',
      createExpressPayableRoutes(createPayable({ providers: { stripe: provider }, storage }), {
        authenticate: (req, res, next) => {
          if (req.headers.authorization === 'Bearer ok') {
            next();
            return;
          }
          res.status(401).json({ error: 'UNAUTHENTICATED' });
        },
      }),
    );

    const blocked = await request(app)
      .post('/payable/checkout')
      .send({
        billable,
        subscription: { name: 'default', price: 'price_pro' },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      });
    expect(blocked.status).toBe(401);

    const webhook = await request(app)
      .post('/payable/webhooks')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_auth"}');
    expect(webhook.status).toBe(200);

    const allowed = await request(app)
      .post('/payable/checkout')
      .set('Authorization', 'Bearer ok')
      .send({
        billable,
        subscription: { name: 'default', price: 'price_pro' },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      });
    expect(allowed.status).toBe(201);
    await db.destroy();
  });

  it('maps not-implemented operations to 501', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app).get('/payable/invoices');
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('NOT_IMPLEMENTED');
  });

  it('rejects a webhook whose body was parsed by an upstream JSON parser', async () => {
    const provider = new FakeProvider();
    const app = express();
    app.use(express.json());
    app.use(
      '/payable',
      createExpressPayableRoutes(createPayable({ providers: { stripe: provider } })),
    );

    const res = await request(app)
      .post('/payable/webhooks')
      .set('stripe-signature', 'sig')
      .send({ id: 'evt_1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_WEBHOOK_PAYLOAD');
    expect(provider.lastVerifyInput).toBeUndefined();
  });

  it('returns 422 for a malformed checkout body instead of a 500', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app)
      .post('/payable/checkout')
      .send({ successUrl: 'https://app.test' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('returns 422 for a refund with an invalid currency instead of a 500', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app)
      .post('/payable/refunds')
      .send({ paymentId: 'pay_1', amount: { amount: 100, currency: 'NOPE' } });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('rejects an invalid email or non-URL redirect in checkout', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app)
      .post('/payable/checkout')
      .send({
        billable: { ...billable, email: 'not-an-email' },
        subscription: { name: 'default', price: 'price_pro' },
        successUrl: 'not-a-url',
        cancelUrl: 'also-not-a-url',
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('rejects an oversized request body with a matching error body', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app)
      .post('/payable/checkout')
      .send({ billable, note: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with an INVALID_JSON body, not INTERNAL_ERROR', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app)
      .post('/payable/checkout')
      .set('Content-Type', 'application/json')
      .send('{ not valid json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_JSON');
  });

  it('rejects a refund body with a non-positive amount', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app)
      .post('/payable/refunds')
      .send({ paymentId: 'pay_1', amount: { amount: -5, currency: 'USD' } });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

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
});
