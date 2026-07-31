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
  it('lists subscriptions, gets one, and lists refunds over HTTP', async () => {
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
    const app = await makeApp(payable);

    const list = await app.inject({
      method: 'GET',
      url: '/payable/subscriptions',
      query: { billableType: 'User', billableId: '1' },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]?.name).toBe('default');

    const one = await app.inject({
      method: 'GET',
      url: '/payable/subscriptions/default',
      query: { billableType: 'User', billableId: '1' },
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().status).toBe('active');

    const missingSub = await app.inject({
      method: 'GET',
      url: '/payable/subscriptions/nope',
      query: { billableType: 'User', billableId: '1' },
    });
    expect(missingSub.statusCode).toBe(404);

    const refunds = await app.inject({
      method: 'GET',
      url: '/payable/refunds',
      query: { paymentId: payment.id },
    });
    expect(refunds.statusCode).toBe(200);
    expect(refunds.json()[0]?.amount).toBe(4000);
    await app.close();
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
    const app = await makeApp(payable);

    const res = await app.inject({
      method: 'GET',
      url: '/payable/invoices/in_fake/pdf?billableType=User&billableId=1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('in_fake.pdf');
    expect(Buffer.from(res.rawPayload)).toEqual(Buffer.from([1, 2, 3]));

    const otherCustomer = await app.inject({
      method: 'GET',
      url: '/payable/invoices/in_fake/pdf?billableType=User&billableId=2',
    });
    expect(otherCustomer.statusCode).toBe(404);

    const missing = await app.inject({
      method: 'GET',
      url: '/payable/invoices/in_missing/pdf?billableType=User&billableId=1',
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
    await db.destroy();
  });
});
