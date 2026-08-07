import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { LocalSubscriptionResource } from '../src/index';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

async function setupStoredSubscription(options: { binding?: boolean } = {}) {
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
    providerSubscriptionId: 'sub_1',
    status: 'active',
    priceId: 'price_pro',
    quantity: 1,
    trialEndsAt: null,
    endsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
  });
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

  it('hides a subscription whose stored provider binding is missing', async () => {
    const { database, payable, subscription } = await setupStoredSubscription({ binding: false });
    const resource = payable.subscription(subscription.id);

    await expect(resource.retrieve()).rejects.toMatchObject({
      code: 'SUBSCRIPTION_NOT_FOUND',
      context: { identifier: subscription.id },
    });
    await database.destroy();
  });

  it('hides a subscription whose provider subscription id is missing', async () => {
    const { database, payable, storage, subscription } = await setupStoredSubscription();
    await storage.subscriptions.update(subscription.id, { providerSubscriptionId: null });
    const resource = payable.subscription(subscription.id);

    await expect(resource.retrieve()).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });
    await database.destroy();
  });
});
