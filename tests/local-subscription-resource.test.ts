import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { LocalSubscriptionResource } from '../src/index';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

async function setupStoredSubscription(
  options: { binding?: boolean; providerSubscriptionId?: string | null } = {},
) {
  const database = createTestDb();
  await migrate(database);
  const storage = new KnexStorageDriver(database, new FakeClock());
  const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
  const customer = await storage.customers.create({
    tenantId: null,
    billableType: 'Team',
    billableId: 'team_1',
    email: 'owner@example.com',
    name: 'Owner',
    metadata: null,
  });
  if (options.binding !== false) {
    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_1',
    });
  }
  const subscription = await storage.subscriptions.create({
    tenantId: null,
    customerId: customer.id,
    name: 'default',
    provider: 'stripe',
    providerSubscriptionId:
      options.providerSubscriptionId === undefined ? 'sub_1' : options.providerSubscriptionId,
    status: 'active',
    priceId: 'price_pro',
    quantity: 1,
    trialEndsAt: null,
    endsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  });
  if (subscription.providerSubscriptionId) {
    await storage.subscriptionProviderBindings.create({
      tenantId: null,
      subscriptionId: subscription.id,
      provider: 'stripe',
      providerSubscriptionId: subscription.providerSubscriptionId,
      providerSyncedAt: null,
    });
  }
  return { database, payable, storage, subscription };
}

describe('local subscription resource', () => {
  it('requires an explicit tenant when tenancy is enabled', async () => {
    const database = createTestDb();
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage,
      tenant: { enabled: true },
    });

    expect(() => payable.subscription('sub_local')).toThrowError(
      expect.objectContaining({ code: 'TENANT_REQUIRED' }),
    );
    await database.destroy();
  });

  it('retrieves the canonical subscription by local id', async () => {
    const { database, payable, subscription } = await setupStoredSubscription();

    const resource: LocalSubscriptionResource = payable.subscription(subscription.id);

    await expect(resource.retrieve()).resolves.toMatchObject({
      id: subscription.id,
      providerSubscriptionId: 'sub_1',
    });
    await expect(resource.get()).resolves.toMatchObject({ id: subscription.id });
    expect(resource.previewChange).toBeTypeOf('function');
    expect(resource.applyChange).toBeTypeOf('function');
    expect(resource.pauseSubscription).toBeTypeOf('function');
    expect(resource.resumePausedSubscription).toBeTypeOf('function');
    expect(resource.pausePaymentCollection).toBeTypeOf('function');
    expect(resource.resumePaymentCollection).toBeTypeOf('function');
    await database.destroy();
  });

  it('returns not found for a local id owned by another tenant', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage,
      tenant: { enabled: true },
    });
    const customer = await storage.customers.create({
      tenantId: 'tenant_a',
      billableType: 'Team',
      billableId: 'team_1',
      email: 'owner@example.com',
      name: 'Owner',
      metadata: null,
    });
    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_1',
    });
    const subscription = await storage.subscriptions.create({
      tenantId: 'tenant_a',
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      priceId: 'price_pro',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });

    const resource = payable.subscription(subscription.id, 'tenant_b');
    await expect(resource.retrieve()).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });
    await database.destroy();
  });

  it('retrieves local state when the customer has no provider binding', async () => {
    const { database, payable, subscription } = await setupStoredSubscription({ binding: false });
    const resource = payable.subscription(subscription.id);

    await expect(resource.retrieve()).resolves.toMatchObject({ id: subscription.id });
    await database.destroy();
  });

  it('retrieves local state when no provider subscription id exists', async () => {
    const { database, payable, subscription } = await setupStoredSubscription({
      providerSubscriptionId: null,
    });
    const resource = payable.subscription(subscription.id);

    await expect(resource.retrieve()).resolves.toMatchObject({
      id: subscription.id,
      providerSubscriptionId: null,
    });
    await database.destroy();
  });
});
