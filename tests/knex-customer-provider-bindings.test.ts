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

describe('Knex customer provider bindings', () => {
  it('stores independent provider bindings for one logical customer', async () => {
    const customer = await storage.customers.create(makeCustomer());
    const stripe = await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'stripe-eu',
      providerCustomerId: 'cus_stripe',
    });
    const paddle = await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'paddle',
      providerCustomerId: 'ctm_paddle',
    });

    expect(
      await storage.customerProviderBindings.findByCustomerAndProvider(
        customer.id,
        'stripe-eu',
        null,
      ),
    ).toEqual(stripe);
    expect(
      await storage.customerProviderBindings.findByCustomerAndProvider(customer.id, 'paddle', null),
    ).toEqual(paddle);
  });

  it('enforces one binding per customer and registered provider', async () => {
    const customer = await storage.customers.create(makeCustomer());
    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'stripe-eu',
      providerCustomerId: 'cus_first',
    });

    await expect(
      storage.customerProviderBindings.create({
        customerId: customer.id,
        provider: 'stripe-eu',
        providerCustomerId: 'cus_second',
      }),
    ).rejects.toThrow();
  });

  it('allows the same opaque customer id under different registered providers', async () => {
    const first = await storage.customers.create(makeCustomer({ billableId: 'first' }));
    const second = await storage.customers.create(makeCustomer({ billableId: 'second' }));
    await storage.customerProviderBindings.create({
      customerId: first.id,
      provider: 'stripe-eu',
      providerCustomerId: 'cus_shared',
    });

    await expect(
      storage.customerProviderBindings.create({
        customerId: second.id,
        provider: 'stripe-us',
        providerCustomerId: 'cus_shared',
      }),
    ).resolves.toMatchObject({ provider: 'stripe-us' });
  });

  it('scopes provider binding lookups through the owning customer tenant', async () => {
    const customer = await storage.customers.create(makeCustomer({ tenantId: 'tenant-a' }));
    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_tenant',
    });

    expect(
      await storage.customerProviderBindings.findByProviderId('stripe', 'cus_tenant', 'tenant-b'),
    ).toBeNull();
    expect(
      await storage.customerProviderBindings.findByProviderId('stripe', 'cus_tenant', 'tenant-a'),
    ).toMatchObject({ customerId: customer.id });
  });

  it('enforces provider id uniqueness within a registered provider', async () => {
    const first = await storage.customers.create(makeCustomer({ billableId: 'first' }));
    const second = await storage.customers.create(makeCustomer({ billableId: 'second' }));
    await storage.customerProviderBindings.create({
      customerId: first.id,
      provider: 'stripe',
      providerCustomerId: 'cus_dup',
    });

    await expect(
      storage.customerProviderBindings.create({
        customerId: second.id,
        provider: 'stripe',
        providerCustomerId: 'cus_dup',
      }),
    ).rejects.toThrow();
  });
});
