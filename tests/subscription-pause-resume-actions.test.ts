import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { defineSubscriptionOperationCapabilities } from '../src/domain/dtos/subscription-operation-capabilities.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { SubscriptionLifecycleProvider } from './support/subscription-lifecycle-provider';

const billable = { billableType: 'User', billableId: 'pause-1', email: 'pause@example.test' };
const now = new Date('2026-08-07T10:00:00.000Z');

const databases: ReturnType<typeof createTestDb>[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

async function setup(provider = new SubscriptionLifecycleProvider()) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const storage = new KnexStorageDriver(database, new FakeClock(now));
  const payable = createPayable({ providers: { stripe: provider }, storage });
  const subscription = await payable
    .customer(billable)
    .newSubscription('default')
    .price('price_pro')
    .create();
  return { payable, provider, storage, subscription };
}

describe('subscription pause and resume actions', () => {
  it('persists an immediate pause followed by a scheduled paused-subscription resume', async () => {
    const { payable, storage, subscription } = await setup();
    const manager = payable.customer(billable).subscription('default');

    await expect(
      manager.pauseSubscription({
        effectiveTiming: 'immediate',
        resumeAt: null,
        resumeBillingPolicy: 'startNewBillingPeriod',
      }),
    ).resolves.toMatchObject({ status: 'paused', scheduledChangeAction: null });
    await expect(
      manager.resumePausedSubscription({
        effectiveTiming: 'scheduled',
        effectiveAt: new Date('2026-09-15T00:00:00.000Z'),
        billingPolicy: 'continueExistingBillingPeriod',
      }),
    ).resolves.toMatchObject({
      status: 'paused',
      scheduledChangeAction: 'resume',
      scheduledChangeEffectiveAt: new Date('2026-09-15T00:00:00.000Z'),
      resumeBillingPolicy: 'continueExistingBillingPeriod',
    });
    const actions = (
      await storage.auditLogs.list({ resourceType: 'subscription', resourceId: subscription.id })
    ).map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['subscription.paused', 'subscription.resume_scheduled']),
    );
  });

  it('persists a scheduled lifecycle pause and a distinct audit action', async () => {
    const { payable, provider, storage, subscription } = await setup();
    await storage.subscriptions.update(
      subscription.id,
      { currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z') },
      null,
    );

    await expect(
      payable
        .customer(billable)
        .subscription('default')
        .pauseSubscription({
          effectiveTiming: 'nextRenewal',
          resumeAt: new Date('2026-08-31T00:00:00.000Z'),
          resumeBillingPolicy: 'continueExistingBillingPeriod',
        }),
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_PAUSE_POLICY_INVALID',
      context: { field: 'resumeAt' },
    });
    expect(provider.pauseCalls).toBe(0);

    const updated = await payable
      .customer(billable)
      .subscription('default')
      .pauseSubscription({
        effectiveTiming: 'nextRenewal',
        resumeAt: new Date('2026-10-01T00:00:00.000Z'),
        resumeBillingPolicy: 'continueExistingBillingPeriod',
      });

    expect(updated).toMatchObject({
      status: 'active',
      scheduledChangeAction: 'pause',
      scheduledChangeEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      scheduledResumeAt: new Date('2026-10-01T00:00:00.000Z'),
      resumeBillingPolicy: 'continueExistingBillingPeriod',
    });
    expect(
      (
        await storage.auditLogs.list({ resourceType: 'subscription', resourceId: subscription.id })
      ).map((entry) => entry.action),
    ).toContain('subscription.pause_scheduled');
  });

  it('keeps lifecycle status active while pausing and resuming payment collection', async () => {
    const { payable } = await setup();
    const manager = payable.customer(billable).subscription('default');

    const paused = await manager.pausePaymentCollection({
      behavior: 'void',
      resumesAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(paused).toMatchObject({
      status: 'active',
      paymentCollectionPauseBehavior: 'void',
      paymentCollectionResumesAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await expect(manager.resumePaymentCollection()).resolves.toMatchObject({
      status: 'active',
      paymentCollectionPauseBehavior: null,
      paymentCollectionResumesAt: null,
    });
  });

  it('clears persisted scheduling only after explicit provider cancellation succeeds', async () => {
    const { payable } = await setup();
    const manager = payable.customer(billable).subscription('default');
    await manager.pauseSubscription({
      effectiveTiming: 'nextRenewal',
      resumeAt: null,
      resumeBillingPolicy: 'startNewBillingPeriod',
    });

    await expect(manager.cancelScheduledSubscriptionChange()).resolves.toMatchObject({
      scheduledChangeAction: null,
      scheduledChangeEffectiveAt: null,
      scheduledResumeAt: null,
      resumeBillingPolicy: null,
    });
  });

  it('does not mutate local state or audit a failed provider pause', async () => {
    const provider = new SubscriptionLifecycleProvider();
    const { payable, storage, subscription } = await setup(provider);
    provider.failPause = true;

    await expect(
      payable.customer(billable).subscription('default').pauseSubscription({
        effectiveTiming: 'immediate',
        resumeAt: null,
        resumeBillingPolicy: 'startNewBillingPeriod',
      }),
    ).rejects.toThrow('provider pause failed');

    expect(await storage.subscriptions.findById(subscription.id)).toMatchObject({
      status: 'active',
      scheduledChangeAction: null,
    });
    const actions = (
      await storage.auditLogs.list({ resourceType: 'subscription', resourceId: subscription.id })
    ).map((entry) => entry.action);
    expect(actions).not.toContain('subscription.paused');
  });

  it('rejects an unsupported policy before calling the provider', async () => {
    class StartNewOnlyProvider extends SubscriptionLifecycleProvider {
      override subscriptionOperationCapabilities() {
        const capabilities = super.subscriptionOperationCapabilities();
        return defineSubscriptionOperationCapabilities({
          ...capabilities,
          pause: {
            ...capabilities.pause,
            subscription: {
              ...capabilities.pause.subscription,
              resumeBillingPolicies: ['startNewBillingPeriod'],
            },
          },
        });
      }
    }
    const provider = new StartNewOnlyProvider();
    const { payable } = await setup(provider);

    await expect(
      payable.customer(billable).subscription('default').pauseSubscription({
        effectiveTiming: 'immediate',
        resumeAt: null,
        resumeBillingPolicy: 'continueExistingBillingPeriod',
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'subscriptions.pause.continueExistingBillingPeriod' },
    });
    expect(provider.pauseCalls).toBe(0);
  });
});
