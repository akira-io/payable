import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebhookDependencies } from '../src/application/builders/webhook-dependencies';
import { ProcessWebhookPipeline } from '../src/application/pipelines/webhooks/process-webhook.pipeline';
import { createPayable } from '../src/create-payable';
import type { Repositories } from '../src/domain/contracts/storage-driver.contract';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { SyncQueueDriver } from '../src/infrastructure/queue/sync/sync-queue-driver';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

let db: Knex;
let clock: FakeClock;
let storage: KnexStorageDriver;
let provider: FakeProvider;
let payable: Payable;

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };
beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
  provider = new FakeProvider();
  payable = createPayable({ providers: { stripe: provider }, storage, clock });
});

afterEach(async () => {
  await db.destroy();
});

async function seedSubscription() {
  return payable.customer(billable).newSubscription('default').price('price_pro').create();
}

describe('webhook subscription reconciliation (C1)', () => {
  it('backfills null provider item identities by price across reordered retries', async () => {
    const subscription = await payable
      .customer(billable)
      .newSubscription('items')
      .price('price_primary')
      .addItem('price_addon', 2)
      .create();
    provider.verifyResult = {
      providerEventId: 'evt_items_first',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: subscription.providerSubscriptionId ?? 'sub_fake',
      status: 'past_due',
      currentPeriodEnd: null,
      trialEndsAt: null,
      items: [
        { providerItemId: 'si_addon', priceId: 'price_addon', quantity: 5 },
        { providerItemId: 'si_primary', priceId: 'price_primary', quantity: 1 },
      ],
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    provider.verifyResult = { ...provider.verifyResult, providerEventId: 'evt_items_retry' };
    provider.reconcileResult = {
      ...provider.reconcileResult,
      items: [...(provider.reconcileResult.items ?? [])].reverse(),
    };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const items = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerItemId: 'si_primary',
          priceId: 'price_primary',
          quantity: 1,
        }),
        expect.objectContaining({
          providerItemId: 'si_addon',
          priceId: 'price_addon',
          quantity: 5,
        }),
      ]),
    );
  });

  it('updates local subscription status from a provider event', async () => {
    const subscription = await seedSubscription();
    provider.verifyResult = {
      providerEventId: 'evt_1',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: subscription.providerSubscriptionId ?? 'sub_fake',
      status: 'past_due',
      currentPeriodEnd: new Date('2026-07-22T00:00:00.000Z'),
      trialEndsAt: null,
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.subscriptions.findByProviderId('stripe', 'sub_fake');
    expect(reloaded?.status).toBe('past_due');
  });

  it('records ends_at when the provider cancels the subscription', async () => {
    await seedSubscription();
    const periodEnd = new Date('2026-07-22T00:00:00.000Z');
    provider.verifyResult = {
      providerEventId: 'evt_2',
      type: 'customer.subscription.deleted',
      normalizedType: 'subscription.cancelled',
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'canceled',
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.subscriptions.findByProviderId('stripe', 'sub_fake');
    expect(reloaded?.status).toBe('canceled');
    expect(reloaded?.endsAt?.toISOString()).toBe(periodEnd.toISOString());
  });

  it('rolls back the reconcile when the outbox write fails (atomic outbox)', async () => {
    const subscription = await seedSubscription();
    provider.reconcileResult = {
      providerSubscriptionId: subscription.providerSubscriptionId ?? 'sub_fake',
      status: 'past_due',
      currentPeriodEnd: new Date('2026-07-22T00:00:00.000Z'),
      trialEndsAt: null,
    };

    const failing = Object.create(storage) as KnexStorageDriver;
    failing.transaction = (work) =>
      storage.transaction((repos) =>
        work({
          ...repos,
          outboxEvents: {
            ...repos.outboxEvents,
            create: async () => {
              throw new Error('outbox boom');
            },
          },
        } as Repositories),
      );

    const deps: WebhookDependencies = {
      provider,
      providerName: 'stripe',
      storage: failing,
      queue: new SyncQueueDriver(),
      events: new InMemoryEventBus(),
      clock,
    };

    await expect(
      new ProcessWebhookPipeline(deps).handle({
        verified: {
          providerEventId: 'evt_atomic',
          type: 'customer.subscription.updated',
          normalizedType: 'subscription.updated',
          data: {},
        },
        webhookEventId: 'wh_atomic',
        correlationId: 'corr_atomic',
        tenantId: null,
      }),
    ).rejects.toThrow('outbox boom');

    const reloaded = await storage.subscriptions.findByProviderId('stripe', 'sub_fake');
    expect(reloaded?.status).toBe(subscription.status);
  });

  it('does not resurrect a canceled subscription or overwrite its dates from an out-of-order event', async () => {
    await seedSubscription();
    await payable.customer(billable).subscription('default').cancelNow();
    const before = await storage.subscriptions.findByProviderId('stripe', 'sub_fake');
    provider.verifyResult = {
      providerEventId: 'evt_stale',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'active',
      currentPeriodEnd: new Date('2026-07-22T00:00:00.000Z'),
      trialEndsAt: new Date('2026-08-01T00:00:00.000Z'),
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.subscriptions.findByProviderId('stripe', 'sub_fake');
    expect(reloaded?.status).toBe('canceled');
    expect(reloaded?.currentPeriodEnd?.toISOString() ?? null).toBe(
      before?.currentPeriodEnd?.toISOString() ?? null,
    );
    expect(reloaded?.trialEndsAt?.toISOString() ?? null).toBe(
      before?.trialEndsAt?.toISOString() ?? null,
    );
  });

  it('rejects a stale subscription event that arrives after a newer one', async () => {
    await seedSubscription();
    provider.verifyResult = {
      providerEventId: 'evt_newer',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      occurredAt: new Date('2026-06-22T10:00:00.000Z'),
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'past_due',
      currentPeriodEnd: new Date('2026-07-22T00:00:00.000Z'),
      trialEndsAt: null,
    };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    provider.verifyResult = {
      providerEventId: 'evt_older',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      occurredAt: new Date('2026-06-22T09:00:00.000Z'),
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'active',
      currentPeriodEnd: new Date('2026-06-22T00:00:00.000Z'),
      trialEndsAt: null,
    };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.subscriptions.findByProviderId('stripe', 'sub_fake');
    const binding = await storage.subscriptionProviderBindings.findByProviderId(
      'stripe',
      'sub_fake',
      null,
    );
    expect(reloaded?.status).toBe('past_due');
    expect(binding?.providerSyncedAt?.toISOString()).toBe('2026-06-22T10:00:00.000Z');
    expect(reloaded?.providerSyncedAt?.toISOString()).toBe('2026-06-22T10:00:00.000Z');
    expect(reloaded?.currentPeriodEnd?.toISOString()).toBe('2026-07-22T00:00:00.000Z');
  });

  it('applies a newer subscription event and advances the provider sync time', async () => {
    await seedSubscription();
    provider.verifyResult = {
      providerEventId: 'evt_first',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      occurredAt: new Date('2026-06-22T10:00:00.000Z'),
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'past_due',
      currentPeriodEnd: null,
      trialEndsAt: null,
    };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    provider.verifyResult = {
      providerEventId: 'evt_second',
      type: 'customer.subscription.updated',
      normalizedType: 'subscription.updated',
      occurredAt: new Date('2026-06-22T11:00:00.000Z'),
      data: {},
    };
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
    };
    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    const reloaded = await storage.subscriptions.findByProviderId('stripe', 'sub_fake');
    const binding = await storage.subscriptionProviderBindings.findByProviderId(
      'stripe',
      'sub_fake',
      null,
    );
    expect(reloaded?.status).toBe('active');
    expect(binding?.providerSyncedAt?.toISOString()).toBe('2026-06-22T11:00:00.000Z');
    expect(reloaded?.providerSyncedAt?.toISOString()).toBe('2026-06-22T11:00:00.000Z');
  });
});
