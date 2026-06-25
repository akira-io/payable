import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const storage = new KnexStorageDriver(db, new FakeClock());
  const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
  const customer = await payable.customers().create(billable);
  return { db, storage, payable, customer };
}

describe('payable subscription and refund reads', () => {
  it('lists subscriptions for a billable', async () => {
    const { db, storage, payable, customer } = await setup();
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

    const subscriptions = await payable.customer(billable).subscriptions();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.name).toBe('default');
    await db.destroy();
  });

  it('gets a single subscription by name, null when absent', async () => {
    const { db, storage, payable, customer } = await setup();
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

    expect((await payable.customer(billable).subscription('default').get())?.status).toBe('active');
    expect(await payable.customer(billable).subscription('missing').get()).toBeNull();
    await db.destroy();
  });

  it('lists refunds for a payment', async () => {
    const { db, storage, payable, customer } = await setup();
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      providerPaymentId: 'pi_1',
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

    const refunds = await payable.refunds().list(payment.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.amount).toBe(4000);
    await db.destroy();
  });

  it('downloads an invoice pdf by provider invoice id', async () => {
    const { db, storage, payable, customer } = await setup();
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

    const pdf = await payable.invoices().downloadPdf('in_fake');
    expect(pdf.filename).toBe('in_fake.pdf');
    expect(pdf.content).toEqual(new Uint8Array([1, 2, 3]));

    await expect(payable.invoices().downloadPdf('in_missing')).rejects.toMatchObject({
      code: 'INVOICE_NOT_FOUND',
    });
    await db.destroy();
  });
});
