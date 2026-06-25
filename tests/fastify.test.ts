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

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('fastify adapter', () => {
  it('rejects a checkout body larger than the route limit', async () => {
    const app = await makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await app.inject({
      method: 'POST',
      url: '/payable/checkout',
      payload: { billable, note: 'x'.repeat(70 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it('creates a subscription checkout session', async () => {
    const provider = new FakeProvider();
    const app = await makeApp(createPayable({ providers: { stripe: provider } }));

    const res = await app.inject({
      method: 'POST',
      url: '/payable/checkout',
      payload: {
        billable,
        subscription: { name: 'default', price: 'price_pro', trialDays: 14 },
        successUrl: 'https://app.test/s',
        cancelUrl: 'https://app.test/c',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });
    expect(provider.lastCheckout?.input.trialDays).toBe(14);
    await app.close();
  });

  it('rejects checkout with an invalid body', async () => {
    const app = await makeApp(createPayable({ providers: { stripe: new FakeProvider() } }));
    const res = await app.inject({
      method: 'POST',
      url: '/payable/checkout',
      payload: { billable: { billableType: '', billableId: '', email: 'nope' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('VALIDATION_FAILED');
    await app.close();
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
    expect(created.json().providerCustomerId).toBe('cus_fake');

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
});
