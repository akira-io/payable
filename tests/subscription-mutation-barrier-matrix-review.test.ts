import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { SubscriptionLifecycleProvider } from './support/subscription-lifecycle-provider';

const billable = { billableType: 'User', billableId: 'barrier-1', email: 'barrier@example.test' };
const now = new Date('2026-08-07T10:00:00.000Z');
const databases: ReturnType<typeof createTestDb>[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.destroy())));

describe('subscription mutation barrier matrix', () => {
  it('blocks every lifecycle mutation behind the same retained durable owner', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new SubscriptionLifecycleProvider();
    const storage = new KnexStorageDriver(database, new FakeClock(now));
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const subscription = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .create();
    await storage.transaction(async (repositories) => {
      await repositories.subscriptionMutationClaims.acquire({
        claimReference: 'subscription-mutation:barrier-matrix',
        tenantId: null,
        subscriptionId: subscription.id,
        ownerToken: 'barrier-matrix-owner',
        operation: 'subscription_quantity_update',
        correlationId: 'barrier-matrix-correlation',
        intent: null,
        claimedAt: now,
      });
    });
    const manager = payable.customer(billable).subscription('default');
    const mutations: Array<[string, () => Promise<unknown>]> = [
      ['cancel', () => manager.cancel()],
      ['cancel-now', () => manager.cancelNow()],
      ['resume', () => manager.resume()],
      [
        'swap',
        () =>
          manager.swap({
            priceId: 'price_other',
            effectiveTiming: 'immediate',
            prorationPolicy: 'prorateImmediately',
            paymentFailurePolicy: 'preventChange',
          }),
      ],
      [
        'quantity',
        () =>
          manager.updateQuantity({
            quantity: 2,
            effectiveTiming: 'immediate',
            prorationPolicy: 'prorateImmediately',
            paymentFailurePolicy: 'preventChange',
          }),
      ],
      [
        'pause',
        () =>
          manager.pauseSubscription({
            effectiveTiming: 'immediate',
            resumeAt: null,
            resumeBillingPolicy: 'startNewBillingPeriod',
          }),
      ],
      [
        'pause-collection',
        () => manager.pausePaymentCollection({ behavior: 'void', resumesAt: null }),
      ],
      [
        'resume-paused',
        () =>
          manager.resumePausedSubscription({
            effectiveTiming: 'immediate',
            billingPolicy: 'continueExistingBillingPeriod',
          }),
      ],
      ['resume-collection', () => manager.resumePaymentCollection()],
      ['cancel-scheduled', () => manager.cancelScheduledSubscriptionChange()],
    ];
    for (const [label, mutation] of mutations) {
      await expect(mutation(), label).rejects.toMatchObject({
        code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
        correlationId: 'barrier-matrix-correlation',
        context: { claimReference: 'subscription-mutation:barrier-matrix' },
      });
    }
    expect(provider.pauseCalls).toBe(0);
  });
});
