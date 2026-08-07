import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { SubscriptionDTO } from '../src/domain/dtos/subscription.dto';
import { defineSubscriptionOperationCapabilities } from '../src/domain/dtos/subscription-operation-capabilities.dto';
import { isPauseSubscriptionCapable, type PauseSubscriptionCapable } from '../src/index';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';
import { storeSubscription } from './support/local-subscription';

class PausingProvider extends FakeProvider {
  pauseCalls = 0;
  lastPauseContext?: OperationContext;

  override subscriptionOperationCapabilities() {
    return defineSubscriptionOperationCapabilities({
      ...super.subscriptionOperationCapabilities(),
      pause: {
        effectiveTimings: ['immediate'],
        scheduledResume: false,
        resumeBillingPolicies: [],
      },
    });
  }

  pauseSubscription(
    input: { providerSubscriptionId: string },
    context: OperationContext,
  ): Promise<SubscriptionDTO> {
    this.pauseCalls += 1;
    this.lastPauseContext = context;
    return Promise.resolve({
      providerSubscriptionId: input.providerSubscriptionId,
      status: 'paused',
      currentPeriodEnd: null,
      trialEndsAt: null,
    });
  }
}

class UnadvertisedPauseProvider extends PausingProvider {
  override subscriptionOperationCapabilities() {
    return defineSubscriptionOperationCapabilities({
      ...super.subscriptionOperationCapabilities(),
      pause: {
        effectiveTimings: [],
        scheduledResume: false,
        resumeBillingPolicies: [],
      },
    });
  }
}

describe('subscription pause', () => {
  it('exports the optional pause runtime contract', () => {
    const provider: PausingProvider & PauseSubscriptionCapable = new PausingProvider();

    expect(isPauseSubscriptionCapable(provider)).toBe(true);
    expect(isPauseSubscriptionCapable(new FakeProvider())).toBe(false);
  });

  it('pauses through the local id with audit and operation idempotency context', async () => {
    const database = createTestDb();
    await migrate(database);
    const provider = new PausingProvider();
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const { subscription } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
    });

    const paused = await payable.subscription(subscription.id).pause();
    const auditLogs = await payable
      .auditLogs()
      .run({ resourceType: 'subscription', resourceId: subscription.id });

    expect(paused).toMatchObject({ id: subscription.id, status: 'paused' });
    expect(provider.pauseCalls).toBe(1);
    expect(provider.lastPauseContext?.idempotencyKey).toContain('subscription:pause::stripe:sub_1');
    expect(auditLogs).toContainEqual(expect.objectContaining({ action: 'subscription.paused' }));
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
        .pause(),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'subscriptions.pause' },
    });
    expect(provider.pauseCalls).toBe(0);
    await database.destroy();
  });
});
