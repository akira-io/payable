import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { Payable } from '../src/payable';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { FakeProvider } from './support/fake-provider';

function makeApp(payable: Payable): express.Express {
  const app = express();
  app.use('/payable', createExpressPayableRoutes(payable));
  return app;
}

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('express adapter', () => {
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

  it.each([
    ['limit=0', { limit: '0' }],
    ['limit=101', { limit: '101' }],
    ['limit=1.5', { limit: '1.5' }],
    ['active=maybe', { active: 'maybe' }],
  ])('rejects catalog query %s before calling the provider', async (_name, query) => {
    const provider = new FakeProvider();
    const app = makeApp(createPayable({ providers: { stripe: provider } }));

    const res = await request(app).get('/payable/products').query(query);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_FAILED');
    expect(provider.lastListProducts).toBeUndefined();
  });
});
