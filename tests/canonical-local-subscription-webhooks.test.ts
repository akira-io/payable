import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

describe('canonical local subscription webhooks', () => {
  it('resolves a binding without rewriting accepted terms', async () => {
    const database = createTestDb();
    await migrate(database);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(database, clock);
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });
    const customer = await payable.customers().create({
      billableType: 'User',
      billableId: 'canonical-webhook-user',
      email: 'canonical-webhook@example.com',
    });
    const product = await payable.products().create({ name: 'Canonical webhook product' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const subscription = await payable.canonicalSubscriptions().create({
      customerId: customer.id,
      name: 'canonical',
      priceId: price.id,
      quantity: 2,
      activation: { state: 'active', startsAt: clock.now() },
      collectionResponsibility: 'merchant',
      source: 'api',
    });
    await payable.canonicalSubscriptions().attachProvider(subscription.id, {
      provider: 'stripe',
      providerSubscriptionId: 'sub_canonical',
    });
    provider.verifyResult = {
      providerEventId: 'evt_canonical_binding',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      occurredAt: new Date('2026-06-22T10:00:00.000Z'),
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_canonical',
      status: 'past_due',
      currentPeriodEnd: new Date('2026-07-22T00:00:00.000Z'),
      trialEndsAt: null,
      items: [{ providerItemId: 'si_remote', priceId: 'price_remote', quantity: 99 }],
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.subscriptions.findById(subscription.id);
    expect(reloaded).toMatchObject({
      status: 'past_due',
      canonicalPriceId: price.id,
      acceptedUnitAmount: 2900,
      acceptedQuantity: 2,
      priceId: price.id,
      quantity: 2,
    });
    const [item] = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(item).toMatchObject({ priceId: price.id, quantity: 2, providerItemId: null });
    await database.destroy();
  });
});
