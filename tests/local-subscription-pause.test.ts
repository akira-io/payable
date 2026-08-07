import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { defineSubscriptionOperationCapabilities } from '../src/domain/dtos/subscription-operation-capabilities.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { storeSubscription } from './support/local-subscription';
import { SubscriptionLifecycleProvider } from './support/subscription-lifecycle-provider';

const pausePolicy = {
  effectiveTiming: 'immediate' as const,
  resumeAt: null,
  resumeBillingPolicy: 'startNewBillingPeriod' as const,
};

class UnadvertisedPauseProvider extends SubscriptionLifecycleProvider {
  override subscriptionOperationCapabilities() {
    const capabilities = super.subscriptionOperationCapabilities();
    return defineSubscriptionOperationCapabilities({
      ...capabilities,
      pause: {
        ...capabilities.pause,
        subscription: {
          ...capabilities.pause.subscription,
          effectiveTimings: [],
        },
      },
    });
  }
}

describe('subscription pause', () => {
  it('pauses through the local id with the full lifecycle policy and audit', async () => {
    const database = createTestDb();
    await migrate(database);
    const provider = new SubscriptionLifecycleProvider();
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const { subscription } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
    });

    const paused = await payable.subscription(subscription.id).pauseSubscription(pausePolicy);
    const auditLogs = await payable
      .auditLogs()
      .run({ resourceType: 'subscription', resourceId: subscription.id });

    expect(paused).toMatchObject({ id: subscription.id, status: 'paused' });
    expect(provider.pauseCalls).toBe(1);
    expect(auditLogs).toContainEqual(expect.objectContaining({ action: 'subscription.paused' }));
    await database.destroy();
  });

  it('pauses a trialing subscription', async () => {
    const database = createTestDb();
    await migrate(database);
    const provider = new SubscriptionLifecycleProvider();
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const { subscription } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'trialing',
    });

    const paused = await payable.subscription(subscription.id).pauseSubscription(pausePolicy);

    expect(paused.status).toBe('paused');
    expect(provider.pauseCalls).toBe(1);
    await database.destroy();
  });

  it('resumes a paused subscription through the local id with a lifecycle policy', async () => {
    const database = createTestDb();
    await migrate(database);
    const provider = new SubscriptionLifecycleProvider();
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const { subscription } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'paused',
    });

    const resumed = await payable.subscription(subscription.id).resumePausedSubscription({
      effectiveTiming: 'immediate',
      billingPolicy: 'startNewBillingPeriod',
    });

    expect(resumed).toMatchObject({ id: subscription.id, status: 'active' });
    await database.destroy();
  });

  it.each([
    'past_due',
    'unpaid',
  ] as const)('rejects pause from %s before provider or local mutation', async (status) => {
    const database = createTestDb();
    await migrate(database);
    const provider = new SubscriptionLifecycleProvider();
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const { subscription } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status,
    });

    await expect(
      payable.subscription(subscription.id).pauseSubscription(pausePolicy),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      context: { machine: 'subscription', from: status, transition: 'pause' },
    });
    const persisted = await payable.subscription(subscription.id).retrieve();
    const auditLogs = await payable
      .auditLogs()
      .run({ resourceType: 'subscription', resourceId: subscription.id });

    expect(provider.pauseCalls).toBe(0);
    expect(persisted.status).toBe(status);
    expect(auditLogs).toEqual([]);
    await database.destroy();
  });

  it('rejects an unadvertised pause before calling the provider', async () => {
    const database = createTestDb();
    await migrate(database);
    const provider = new UnadvertisedPauseProvider();
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const { customer } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
    });

    await expect(
      payable
        .customer({ billableType: customer.billableType, billableId: customer.billableId })
        .subscription('default')
        .pauseSubscription(pausePolicy),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'subscriptions.pause' },
    });
    expect(provider.pauseCalls).toBe(0);
    await database.destroy();
  });
});
