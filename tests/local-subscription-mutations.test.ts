import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { AuditLogRepository } from '../src/domain/contracts/audit-log-repository.contract';
import type { Repositories, StorageDriver } from '../src/domain/contracts/storage-driver.contract';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';
import { storeSubscription } from './support/local-subscription';

const changePolicies = {
  effectiveTiming: 'immediate' as const,
  prorationPolicy: 'prorateImmediately' as const,
  paymentFailurePolicy: 'preventChange' as const,
};

async function setupMutation() {
  const database = createTestDb();
  await migrate(database);
  const clock = new FakeClock();
  const storage = new KnexStorageDriver(database, clock);
  const provider = new FakeProvider();
  const payable = createPayable({ providers: { stripe: provider }, storage, clock });
  const { subscription } = await storeSubscription(storage, {
    billableId: 'team_1',
    provider: 'stripe',
    providerSubscriptionId: 'sub_1',
  });
  return { database, payable, provider, storage, subscription };
}

function failTransactionalAudit(storage: StorageDriver): StorageDriver {
  const failingStorage = Object.create(storage) as StorageDriver;
  failingStorage.transaction = async <T>(
    work: (repositories: Repositories) => Promise<T>,
  ): Promise<T> =>
    storage.transaction((repositories) => {
      const failingAuditLogs = Object.create(repositories.auditLogs) as AuditLogRepository;
      failingAuditLogs.create = () => Promise.reject(new Error('audit unavailable'));
      return work({ ...repositories, auditLogs: failingAuditLogs });
    });
  return failingStorage;
}

describe('local subscription mutations', () => {
  it('routes by the stored provider and owning customer when names are duplicated', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const stripe = new FakeProvider('cus_stripe');
    const paddle = new FakeProvider('cus_paddle');
    const payable = createPayable({ providers: { stripe, paddle }, storage });
    const { subscription: paddleSubscription } = await storeSubscription(storage, {
      billableId: 'paddle_team',
      provider: 'paddle',
      providerSubscriptionId: 'sub_paddle',
      quantity: 2,
    });
    const { subscription: stripeSubscription } = await storeSubscription(storage, {
      billableId: 'stripe_team',
      provider: 'stripe',
      providerSubscriptionId: 'sub_stripe',
    });

    const resource = payable.subscription(paddleSubscription.id);
    const updated = await resource.swap({ priceId: 'price_new', ...changePolicies });

    expect(updated).toMatchObject({ id: paddleSubscription.id, priceId: 'price_new' });
    expect(paddle.lastSubscriptionUpdate).toMatchObject({
      providerSubscriptionId: 'sub_paddle',
      priceId: 'price_new',
      quantity: 2,
    });
    expect(stripe.lastSubscriptionUpdate).toBeUndefined();
    await expect(storage.subscriptions.findById(stripeSubscription.id)).resolves.toMatchObject({
      priceId: 'price_old',
    });
    await database.destroy();
  });

  it('updates quantity through the local id and returns the refreshed record', async () => {
    const { database, payable, subscription } = await setupMutation();
    const resource = payable.subscription(subscription.id);

    const updated = await resource.updateQuantity({ quantity: 4, ...changePolicies });

    expect(updated).toMatchObject({ id: subscription.id, quantity: 4 });
    expect(updated).not.toBe(subscription);
    await database.destroy();
  });

  it('fails before provider side effects when only the legacy inline identity exists', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const { subscription } = await storeSubscription(storage, {
      billableId: 'legacy-inline-only',
      provider: 'stripe',
      providerSubscriptionId: 'sub_legacy_inline',
      subscriptionBinding: false,
    });

    await expect(
      payable.subscription(subscription.id).updateQuantity({ quantity: 2, ...changePolicies }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_PROVIDER_BINDING_REQUIRED' });
    expect(provider.lastSubscriptionUpdate).toBeUndefined();
    await database.destroy();
  });

  it('cancels through the local id and writes the existing audit event', async () => {
    const { database, payable, subscription } = await setupMutation();
    const resource = payable.subscription(subscription.id);

    const canceled = await resource.cancel();
    const auditLogs = await payable
      .auditLogs()
      .run({ resourceType: 'subscription', resourceId: subscription.id });

    expect(canceled.endsAt?.toISOString()).toBe('2026-07-22T00:00:00.000Z');
    expect(auditLogs).toContainEqual(expect.objectContaining({ action: 'subscription.canceled' }));
    await database.destroy();
  });

  it('cancels immediately through the local id', async () => {
    const { database, payable, subscription } = await setupMutation();
    const resource = payable.subscription(subscription.id);

    const canceled = await resource.cancelNow();

    expect(canceled).toMatchObject({ id: subscription.id, status: 'canceled' });
    expect(canceled.endsAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    await database.destroy();
  });

  it('resumes through the local id', async () => {
    const { database, payable, subscription } = await setupMutation();
    const resource = payable.subscription(subscription.id);
    await resource.cancel();

    const resumed = await resource.resume();

    expect(resumed).toMatchObject({ id: subscription.id, status: 'active', endsAt: null });
    await database.destroy();
  });

  it('preserves authorization before provider and storage mutation', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage,
      authorization: { enabled: true },
    });
    const { subscription } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
    });
    const resource = payable.subscription(subscription.id);

    await expect(
      resource.swap({
        priceId: 'price_new',
        ...changePolicies,
        authorization: { actorId: 'admin_1', allowed: false },
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(provider.lastSubscriptionUpdate).toBeUndefined();
    await expect(storage.subscriptions.findById(subscription.id)).resolves.toMatchObject({
      priceId: 'price_old',
    });
    await database.destroy();
  });

  it('keeps canonical canceled state when the provider returns stale active state', async () => {
    const { database, payable, storage, subscription } = await setupMutation();
    await storage.subscriptions.update(subscription.id, { status: 'canceled' });
    const resource = payable.subscription(subscription.id);

    const updated = await resource.updateQuantity({ quantity: 2, ...changePolicies });

    expect(updated).toMatchObject({ id: subscription.id, status: 'canceled', quantity: 2 });
    await database.destroy();
  });

  it('rolls back locally and retains recovery ownership when audit persistence fails', async () => {
    const database = createTestDb();
    await migrate(database);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(database, clock);
    const provider = new FakeProvider();
    const { subscription } = await storeSubscription(storage, {
      billableId: 'team_1',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
    });
    const payable = createPayable({
      providers: { stripe: provider },
      storage: failTransactionalAudit(storage),
      clock,
    });

    const rejected = await payable
      .subscription(subscription.id)
      .updateQuantity({ quantity: 8, ...changePolicies })
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({
      code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
      correlationId: expect.any(String),
      context: { claimReference: expect.any(String) },
    });
    expect((rejected as Error).cause).toBeUndefined();
    await expect(storage.subscriptions.findById(subscription.id)).resolves.toMatchObject({
      quantity: 1,
    });
    await expect(
      storage.subscriptionMutationClaims.findActiveBySubscriptionId(subscription.id, null),
    ).resolves.toMatchObject({
      operation: 'subscription_quantity_update',
      status: 'active',
    });
    await database.destroy();
  });
});
