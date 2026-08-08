import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('canonical local subscription bindings', () => {
  it('retrieves locally, blocks provider mutations while unbound, and attaches later', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'team_attach',
      email: 'attach@example.com',
    });
    const product = await payable.products().create({ name: 'Attach Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(1500, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const subscription = await payable.canonicalSubscriptions().create({
      customerId: customer.id,
      name: 'default',
      priceId: price.id,
      activation: { state: 'pending' },
      collectionResponsibility: 'merchant',
      source: 'sdk',
    });

    expect((await payable.subscription(subscription.id).retrieve()).id).toBe(subscription.id);
    await expect(payable.subscription(subscription.id).capabilities()).resolves.toEqual({
      local: { retrieve: true, attachProvider: true },
      providerOperations: [],
    });
    await expect(payable.subscription(subscription.id).cancel()).rejects.toMatchObject({
      code: 'SUBSCRIPTION_PROVIDER_BINDING_REQUIRED',
    });

    const binding = await payable.canonicalSubscriptions().attachProvider(subscription.id, {
      provider: 'stripe',
      providerSubscriptionId: 'sub_attached_123',
    });
    expect(binding).toMatchObject({
      tenantId: null,
      subscriptionId: subscription.id,
      provider: 'stripe',
      providerSubscriptionId: 'sub_attached_123',
    });
    await expect(payable.subscription(subscription.id).capabilities()).resolves.toMatchObject({
      local: { retrieve: true, attachProvider: true },
      providerOperations: [{ provider: 'stripe', bindingId: binding.id, available: false }],
    });
    expect((await payable.subscription(subscription.id).retrieve()).canonicalPriceId).toBe(
      price.id,
    );
    await expect(storage.subscriptions.findById(subscription.id)).resolves.toMatchObject({
      id: subscription.id,
      provider: null,
      providerSubscriptionId: null,
      acceptedUnitAmount: 1500,
    });
    await database.destroy();
  });

  it('isolates customer, price, identity, and provider bindings by tenant', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customerA = await payable.customers(undefined, 'tenant-a').create({
      billableType: 'Team',
      billableId: 'shared-team',
      email: 'a@example.com',
    });
    const productA = await payable.products('tenant-a').create({ name: 'Tenant A' });
    const priceA = await payable.prices('tenant-a').create({
      productId: productA.id,
      unitAmount: Money.of(1000, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });

    await expect(
      payable.canonicalSubscriptions('tenant-b').create({
        customerId: customerA.id,
        name: 'default',
        priceId: priceA.id,
        activation: { state: 'pending' },
        collectionResponsibility: 'merchant',
        source: 'api',
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });

    const customerB = await payable.customers(undefined, 'tenant-b').create({
      billableType: 'Team',
      billableId: 'shared-team',
      email: 'b@example.com',
    });
    await expect(
      payable.canonicalSubscriptions('tenant-b').create({
        customerId: customerB.id,
        name: 'cross-tenant-price',
        priceId: priceA.id,
        activation: { state: 'pending' },
        collectionResponsibility: 'merchant',
        source: 'api',
      }),
    ).rejects.toMatchObject({ code: 'PRICE_NOT_FOUND' });
    const productB = await payable.products('tenant-b').create({ name: 'Tenant B' });
    const priceB = await payable.prices('tenant-b').create({
      productId: productB.id,
      unitAmount: Money.of(2000, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const subscriptionB = await payable.canonicalSubscriptions('tenant-b').create({
      customerId: customerB.id,
      name: 'default',
      priceId: priceB.id,
      activation: { state: 'pending' },
      collectionResponsibility: 'merchant',
      source: 'api',
    });
    await payable.canonicalSubscriptions('tenant-b').attachProvider(subscriptionB.id, {
      provider: 'stripe',
      providerSubscriptionId: 'sub_shared',
    });

    expect(
      await storage.subscriptionProviderBindings.findByProviderId(
        'stripe',
        'sub_shared',
        'tenant-a',
      ),
    ).toBeNull();
    expect(
      await storage.subscriptionProviderBindings.findByProviderId(
        'stripe',
        'sub_shared',
        'tenant-b',
      ),
    ).toMatchObject({ subscriptionId: subscriptionB.id });
    await database.destroy();
  });
});
