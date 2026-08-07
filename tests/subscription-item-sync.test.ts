import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;
let payable: Payable;

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };
const changePolicies = {
  effectiveTiming: 'immediate' as const,
  prorationPolicy: 'prorateImmediately' as const,
  paymentFailurePolicy: 'preventChange' as const,
};

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
  payable = createPayable({ providers: { stripe: new FakeProvider() }, storage, clock });
});

afterEach(async () => {
  await db.destroy();
});

describe('subscription item sync (I2)', () => {
  it('persists provider item identities by price when creation responses are reordered', async () => {
    const provider = new FakeProvider();
    provider.createdSubscriptionItems = [
      { providerItemId: 'si_addon', priceId: 'price_addon', quantity: 2 },
      { providerItemId: 'si_primary', priceId: 'price_primary', quantity: 1 },
    ];
    payable = createPayable({ providers: { stripe: provider }, storage });

    const subscription = await payable
      .customer(billable)
      .newSubscription('mapped')
      .price('price_primary')
      .addItem('price_addon', 2)
      .create();

    const items = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priceId: 'price_primary', providerItemId: 'si_primary' }),
        expect.objectContaining({ priceId: 'price_addon', providerItemId: 'si_addon' }),
      ]),
    );
  });

  it('re-syncs the primary item on swap and quantity change', async () => {
    const subscription = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .create();

    const initial = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(initial).toHaveLength(1);
    expect(initial[0]?.priceId).toBe('price_pro');

    await payable
      .customer(billable)
      .subscription('default')
      .swap({ priceId: 'price_business', ...changePolicies });
    const afterSwap = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(afterSwap[0]?.priceId).toBe('price_business');

    await payable
      .customer(billable)
      .subscription('default')
      .updateQuantity({ quantity: 4, ...changePolicies });
    const afterQuantity = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(afterQuantity[0]?.quantity).toBe(4);
    expect(afterQuantity[0]?.priceId).toBe('price_business');
  });

  it('requires an explicit local item for multi-item mutations', async () => {
    const subscription = await payable
      .customer(billable)
      .newSubscription('multi')
      .price('price_primary')
      .addItem('price_addon', 2)
      .create();

    await expect(
      payable
        .customer(billable)
        .subscription('multi')
        .swap({ priceId: 'price_replacement', ...changePolicies }),
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_ITEM_AMBIGUOUS',
      context: { subscriptionId: subscription.id, itemCount: 2 },
    });
  });

  it('mutates only the explicitly selected local item', async () => {
    const provider = new FakeProvider();
    provider.createdSubscriptionItems = [
      { providerItemId: 'si_primary', priceId: 'price_primary', quantity: 1 },
      { providerItemId: 'si_addon', priceId: 'price_addon', quantity: 2 },
    ];
    payable = createPayable({ providers: { stripe: provider }, storage });
    const subscription = await payable
      .customer(billable)
      .newSubscription('targeted')
      .price('price_primary')
      .addItem('price_addon', 2)
      .create();
    const before = await storage.subscriptionItems.listBySubscription(subscription.id);
    const addon = before.find((subscriptionItem) => subscriptionItem.priceId === 'price_addon');

    await payable
      .customer(billable)
      .subscription('targeted')
      .swap({
        itemId: addon?.id,
        priceId: 'price_addon_replacement',
        ...changePolicies,
      });

    expect(provider.lastSubscriptionUpdate).toMatchObject({
      providerItemId: 'si_addon',
      items: expect.arrayContaining([
        { priceId: 'price_primary', quantity: 1 },
        { priceId: 'price_addon_replacement', quantity: 2 },
      ]),
    });
    const after = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(after.find((subscriptionItem) => subscriptionItem.id === addon?.id)?.priceId).toBe(
      'price_addon_replacement',
    );
    expect(after.find((subscriptionItem) => subscriptionItem.id !== addon?.id)?.priceId).toBe(
      'price_primary',
    );
  });
});
