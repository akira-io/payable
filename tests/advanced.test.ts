import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };
const urls = { successUrl: 'https://app.test/s', cancelUrl: 'https://app.test/c' };

describe('billing portal', () => {
  it('opens a portal session for the customer', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    const portal = await payable.customer(billable).billingPortal('https://app.test/account');
    expect(portal.url).toBe('https://portal.fake/cus_fake');
  });
});

describe('coupons', () => {
  it('forwards a coupon through checkout', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider } });
    await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .coupon('SAVE10')
      .checkout(urls);
    expect(provider.lastCheckout?.input.coupon).toBe('SAVE10');
  });
});

describe('multiple subscription items', () => {
  it('creates a subscription with several prices and persists the items', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });

    const subscription = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_base')
      .addItem('price_addon', 2)
      .coupon('SAVE10')
      .create();

    expect(provider.lastCreateSubscription?.coupon).toBe('SAVE10');
    expect(provider.lastCreateSubscription?.items).toEqual([
      { priceId: 'price_base', quantity: 1 },
      { priceId: 'price_addon', quantity: 2 },
    ]);
    const items = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.priceId).sort()).toEqual(['price_addon', 'price_base']);
    await db.destroy();
  });
});
