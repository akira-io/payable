import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
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

describe('fastify adapter', () => {
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
    const app = await makeApp(createPayable({ providers: { stripe, paddle }, storage }));

    const viaStripe = await app.inject({
      method: 'POST',
      url: '/payable/webhooks/stripe',
      headers: {
        'stripe-signature': 'stripe-sig',
        'paddle-signature': 'wrong',
        'content-type': 'application/json',
      },
      payload: '{"id":"evt_stripe"}',
    });
    expect(viaStripe.statusCode).toBe(200);
    expect(stripe.lastVerifyInput?.signature).toBe('stripe-sig');

    const viaPaddle = await app.inject({
      method: 'POST',
      url: '/payable/webhooks/paddle',
      headers: {
        'paddle-signature': 'paddle-sig',
        'stripe-signature': 'wrong',
        'content-type': 'application/json',
      },
      payload: '{"id":"evt_paddle"}',
    });
    expect(viaPaddle.statusCode).toBe(200);
    expect(paddle.lastVerifyInput?.signature).toBe('paddle-sig');
    await app.close();
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
    const app = await makeApp(createPayable({ providers: { stripe: provider }, storage }));

    const res = await app.inject({
      method: 'POST',
      url: '/payable/webhooks',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: '{"id":"evt_1"}',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(false);
    expect(provider.lastVerifyInput?.payload).toBe('{"id":"evt_1"}');
    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1'))?.status).toBe(
      'processed',
    );
    await app.close();
    await db.destroy();
  });

  it('reads a custom signature header configured with uppercase', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_uc',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const app = await makeApp(createPayable({ providers: { stripe: provider }, storage }), {
      webhookSignatureHeader: 'X-Custom-Signature',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/payable/webhooks',
      headers: { 'x-custom-signature': 'sig-123', 'content-type': 'application/json' },
      payload: '{"id":"evt_uc"}',
    });

    expect(res.statusCode).toBe(200);
    expect(provider.lastVerifyInput?.signature).toBe('sig-123');
    await app.close();
    await db.destroy();
  });

  it('rejects a webhook with a bad signature', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyError = new InvalidWebhookSignatureError('stripe');
    const storage = new KnexStorageDriver(db, new FakeClock());
    const app = await makeApp(createPayable({ providers: { stripe: provider }, storage }));

    const res = await app.inject({
      method: 'POST',
      url: '/payable/webhooks',
      headers: { 'stripe-signature': 'sig', 'content-type': 'application/json' },
      payload: '{"id":"evt_x"}',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_WEBHOOK_SIGNATURE');
    await app.close();
    await db.destroy();
  });
});
