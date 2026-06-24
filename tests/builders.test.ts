import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = {
  billableType: 'User',
  billableId: '1',
  email: 'user@example.com',
  name: 'User',
};
const urls = { successUrl: 'https://app.test/s', cancelUrl: 'https://app.test/c' };

describe('fluent subscription checkout', () => {
  it('syncs the customer and creates a checkout session', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    const session = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .trialDays(14)
      .checkout(urls);

    expect(session).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });
    expect(provider.createCustomerCalls).toBe(1);
    expect(provider.lastCustomerCtx?.idempotencyKey).toBe('customer:stripe:User:1');
    expect(provider.lastCheckout?.input).toMatchObject({
      providerCustomerId: 'cus_fake',
      mode: 'subscription',
      lineItems: [{ priceId: 'price_pro', quantity: 1 }],
      trialDays: 14,
    });
    expect(provider.lastCheckout?.ctx.idempotencyKey).toBe(
      'checkout:stripe:User:1:price_pro%3A1:default',
    );
  });

  it('requires a price before checkout', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    await expect(
      payable.customer(billable).newSubscription('default').checkout(urls),
    ).rejects.toThrow('A price is required');
  });

  it('reuses the stored provider customer on the next checkout', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await payable.customer(billable).newSubscription('default').price('price_pro').checkout(urls);
    await payable.customer(billable).newSubscription('default').price('price_pro').checkout(urls);

    expect(provider.createCustomerCalls).toBe(1);
    expect(await storage.customers.findByBillable('User', '1')).not.toBeNull();
    await db.destroy();
  });
});

describe('payment-mode checkout builder', () => {
  it('builds a one-time payment checkout', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    const session = await payable
      .customer(billable)
      .checkout()
      .mode('payment')
      .addPrice('price_one')
      .create(urls);

    expect(session).toEqual({ id: 'cs_fake', url: 'https://fake.test/cs' });
    expect(provider.lastCheckout?.input.mode).toBe('payment');
    expect(provider.lastCheckout?.input.lineItems).toEqual([{ priceId: 'price_one', quantity: 1 }]);
  });

  it('keys distinct line-item sets distinctly', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    await payable
      .customer(billable)
      .checkout()
      .mode('payment')
      .addPrice('price_a')
      .addPrice('price_b')
      .create(urls);
    const first = provider.lastCheckout?.ctx.idempotencyKey;

    await payable
      .customer(billable)
      .checkout()
      .mode('payment')
      .addPrice('price_a')
      .addPrice('price_c')
      .create(urls);
    const second = provider.lastCheckout?.ctx.idempotencyKey;

    expect(first).not.toBe(second);
  });

  it('keys repeat one-time purchases distinctly via a caller reference', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });

    await payable
      .customer(billable)
      .checkout()
      .mode('payment')
      .addPrice('price_one')
      .create({ ...urls, reference: 'order_1' });
    const first = provider.lastCheckout?.ctx.idempotencyKey;

    await payable
      .customer(billable)
      .checkout()
      .mode('payment')
      .addPrice('price_one')
      .create({ ...urls, reference: 'order_2' });
    const second = provider.lastCheckout?.ctx.idempotencyKey;

    expect(first).toContain(':order_1');
    expect(first).not.toBe(second);
  });
});
