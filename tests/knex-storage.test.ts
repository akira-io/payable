import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb, makeCustomer } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  storage = new KnexStorageDriver(db, new FakeClock(new Date('2026-06-22T00:00:00.000Z')));
});

afterEach(async () => {
  await db.destroy();
});

describe('KnexStorageDriver customers', () => {
  it('creates and reads back a customer with json metadata', async () => {
    const created = await storage.customers.create(
      makeCustomer({ providerCustomerId: 'cus_1', metadata: { plan: 'pro' } }),
    );
    expect(created.id).toBeTruthy();
    expect(created.createdAt.toISOString()).toBe('2026-06-22T00:00:00.000Z');

    expect((await storage.customers.findById(created.id))?.metadata).toEqual({ plan: 'pro' });
    expect((await storage.customers.findByBillable('User', '1'))?.id).toBe(created.id);
    expect((await storage.customers.findByProviderId('stripe', 'cus_1'))?.id).toBe(created.id);
  });

  it('updates only the provided fields', async () => {
    const created = await storage.customers.create(makeCustomer());
    const updated = await storage.customers.update(created.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.email).toBe('user@example.com');
  });

  it('enforces the provider id unique constraint', async () => {
    await storage.customers.create(makeCustomer({ providerCustomerId: 'cus_dup' }));
    await expect(
      storage.customers.create(makeCustomer({ providerCustomerId: 'cus_dup' })),
    ).rejects.toThrow();
  });
});

describe('KnexStorageDriver catalog', () => {
  it('links prices to products and subscriptions to customers', async () => {
    const product = await storage.products.create({
      tenantId: null,
      provider: 'stripe',
      providerProductId: 'prod_1',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    expect(product.active).toBe(true);

    const price = await storage.prices.create({
      tenantId: null,
      provider: 'stripe',
      providerPriceId: 'price_1',
      productId: product.id,
      currency: 'USD',
      unitAmount: 9900,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });
    expect(await storage.prices.listByProduct(product.id)).toHaveLength(1);

    const customer = await storage.customers.create(
      makeCustomer({ providerCustomerId: 'cus_sub' }),
    );
    const subscription = await storage.subscriptions.create({
      tenantId: null,
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      priceId: price.id,
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    expect((await storage.subscriptions.findByName(customer.id, 'default'))?.id).toBe(
      subscription.id,
    );
    expect(await storage.subscriptions.listByCustomer(customer.id)).toHaveLength(1);
  });
});

describe('KnexStorageDriver transactions', () => {
  it('commits work on success', async () => {
    await storage.transaction(async (repositories) => {
      await repositories.customers.create(makeCustomer({ providerCustomerId: 'cus_commit' }));
    });
    expect(await storage.customers.findByProviderId('stripe', 'cus_commit')).not.toBeNull();
  });

  it('rolls back work on failure', async () => {
    await expect(
      storage.transaction(async (repositories) => {
        await repositories.customers.create(makeCustomer({ providerCustomerId: 'cus_rollback' }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await storage.customers.findByProviderId('stripe', 'cus_rollback')).toBeNull();
  });
});
