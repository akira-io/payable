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

  it('threads resolveAuthorization so authorized writes pass and absent context is denied', async () => {
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      authorization: { enabled: true },
    });
    const body = {
      billable,
      subscription: { name: 'default', price: 'price_pro' },
      successUrl: 'https://app.test/s',
      cancelUrl: 'https://app.test/c',
    };

    const authorized = express();
    authorized.use(
      '/payable',
      createExpressPayableRoutes(payable, {
        resolveAuthorization: () => ({ allowed: true, actorId: 'admin' }),
      }),
    );
    const ok = await request(authorized).post('/payable/checkout').send(body);
    expect(ok.status).toBe(201);

    const denied = await request(makeApp(payable)).post('/payable/checkout').send(body);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('AUTHORIZATION_DENIED');
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

  it('resolves the signature header per provider on mixed routes', async () => {
    const db = createTestDb();
    await migrate(db);
    const stripe = new FakeProvider();
    stripe.verifyResult = {
      providerEventId: 'evt_stripe',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: {},
    };
    const paddle = new FakeProvider();
    paddle.verifyResult = {
      providerEventId: 'evt_paddle',
      type: 'subscription.canceled',
      normalizedType: 'subscription.cancelled',
      data: {},
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const app = makeApp(createPayable({ providers: { stripe, paddle }, storage }));

    const viaStripe = await request(app)
      .post('/payable/webhooks/stripe')
      .set('stripe-signature', 'stripe-sig')
      .set('paddle-signature', 'wrong')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_stripe"}');
    expect(viaStripe.status).toBe(200);
    expect(stripe.lastVerifyInput?.signature).toBe('stripe-sig');

    const viaPaddle = await request(app)
      .post('/payable/webhooks/paddle')
      .set('paddle-signature', 'paddle-sig')
      .set('stripe-signature', 'wrong')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_paddle"}');
    expect(viaPaddle.status).toBe(200);
    expect(paddle.lastVerifyInput?.signature).toBe('paddle-sig');
    await db.destroy();
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
});
