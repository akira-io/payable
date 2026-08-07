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
let provider: FakeProvider;
let payable: Payable;

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
  provider = new FakeProvider();
  payable = createPayable({ providers: { stripe: provider }, storage, clock });
});

afterEach(async () => {
  await db.destroy();
});

describe('subscription provider item webhook reconciliation', () => {
  it('deterministically backfills duplicate prices across reordered webhook retries', async () => {
    const subscription = await payable
      .customer(billable)
      .newSubscription('duplicates')
      .price('price_shared')
      .addItem('price_shared', 1)
      .create();
    const before = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(before.every((subscriptionItem) => subscriptionItem.providerItemId === null)).toBe(true);
    provider.verifyResult = {
      providerEventId: 'evt_duplicates_first',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: subscription.providerSubscriptionId ?? 'sub_fake',
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      items: [
        { providerItemId: 'si_z', priceId: 'price_shared', quantity: 1 },
        { providerItemId: 'si_a', priceId: 'price_shared', quantity: 1 },
      ],
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    const first = await storage.subscriptionItems.listBySubscription(subscription.id);
    provider.verifyResult = { ...provider.verifyResult, providerEventId: 'evt_duplicates_retry' };
    provider.reconcileResult = {
      ...provider.reconcileResult,
      items: [...(provider.reconcileResult.items ?? [])].reverse(),
    };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    const retried = await storage.subscriptionItems.listBySubscription(subscription.id);
    const expectedPairs = [...before]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((subscriptionItem, index) => ({
        itemId: subscriptionItem.id,
        providerItemId: index === 0 ? 'si_a' : 'si_z',
      }));
    const pairs = (subscriptionItems: typeof first) =>
      [...subscriptionItems]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((subscriptionItem) => ({
          itemId: subscriptionItem.id,
          providerItemId: subscriptionItem.providerItemId,
        }));

    expect(pairs(first)).toEqual(expectedPairs);
    expect(pairs(retried)).toEqual(expectedPairs);
  });

  it('does not pair ambiguous duplicate prices when webhook identities are missing', async () => {
    const subscription = await payable
      .customer(billable)
      .newSubscription('missing-identities')
      .price('price_shared')
      .addItem('price_shared', 1)
      .create();
    provider.verifyResult = {
      providerEventId: 'evt_missing_identities',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: subscription.providerSubscriptionId ?? 'sub_fake',
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      items: [
        { providerItemId: null, priceId: 'price_shared', quantity: 1 },
        { providerItemId: null, priceId: 'price_shared', quantity: 1 },
      ],
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const subscriptionItems = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(
      subscriptionItems.every((subscriptionItem) => subscriptionItem.providerItemId === null),
    ).toBe(true);
  });
});
