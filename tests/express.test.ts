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

  it('maps not-implemented operations to 501', async () => {
    const app = makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await request(app).get('/payable/invoices');
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('NOT_IMPLEMENTED');
  });
});
