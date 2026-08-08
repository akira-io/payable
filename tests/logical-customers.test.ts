import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { NewCustomer } from '../src/domain/contracts/customer-repository.contract';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const BASE_TIME = new Date('2026-08-07T10:00:00.000Z');

describe('logical customer collection', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];
  let clock: FakeClock;
  let storage: KnexStorageDriver;

  beforeEach(async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    clock = new FakeClock(BASE_TIME);
    storage = new KnexStorageDriver(database, clock);
  });

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  function createCustomer(
    overrides: Partial<NewCustomer>,
  ): Promise<Awaited<ReturnType<typeof storage.customers.create>>> {
    return storage.customers.create({
      tenantId: 'tenant-a',
      billableType: 'User',
      billableId: globalThis.crypto.randomUUID(),
      email: 'customer@example.com',
      name: null,
      metadata: null,
      ...overrides,
    });
  }

  function createTenantPayable() {
    const provider = new FakeProvider();
    Object.defineProperty(provider, 'capabilities', {
      value: () => {
        throw new Error('logical reads must not inspect provider capabilities');
      },
    });
    return createPayable({
      tenant: { enabled: true },
      providers: { stripe: provider },
      storage,
    });
  }

  it('returns an empty provider-neutral page', async () => {
    const page = await createTenantPayable().customers(undefined, 'tenant-a').list();

    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('finds exact customer and billable identities inside the tenant', async () => {
    const customer = await createCustomer({ billableId: 'customer-1' });
    await createCustomer({ tenantId: 'tenant-b', billableId: 'customer-1' });
    const customers = createTenantPayable().customers(undefined, 'tenant-a');

    expect(await customers.find(customer.id)).toEqual(customer);
    expect(await customers.list({ billableType: 'User', billableId: 'customer-1' })).toMatchObject({
      items: [customer],
    });
    expect(await customers.find('missing')).toBeNull();
  });

  it('searches email and name as case-insensitive substrings', async () => {
    const ada = await createCustomer({
      billableId: 'ada',
      email: 'Ada.Lovelace@example.com',
      name: 'Ada Lovelace',
    });
    await createCustomer({ billableId: 'grace', email: 'grace@example.com', name: 'Grace Hopper' });
    const customers = createTenantPayable().customers(undefined, 'tenant-a');

    expect((await customers.list({ email: 'LOVELACE' })).items).toEqual([ada]);
    expect((await customers.list({ name: 'love' })).items).toEqual([ada]);
    expect((await customers.list({ id: ada.id })).items).toEqual([ada]);
  });

  it('continues equal-timestamp pages without duplicates or skipped customers', async () => {
    const created = await Promise.all([
      createCustomer({ billableId: 'one' }),
      createCustomer({ billableId: 'two' }),
      createCustomer({ billableId: 'three' }),
    ]);
    const customers = createTenantPayable().customers(undefined, 'tenant-a');

    const first = await customers.list({ limit: 2 });
    const second = await customers.list({ limit: 2, cursor: first.nextCursor ?? undefined });

    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect([...first.items, ...second.items].map(({ id }) => id).sort()).toEqual(
      created.map(({ id }) => id).sort(),
    );
  });

  it('does not shift continuation when a newer customer is inserted', async () => {
    await createCustomer({ billableId: 'oldest' });
    clock.advance(1_000);
    await createCustomer({ billableId: 'middle' });
    const customers = createTenantPayable().customers(undefined, 'tenant-a');
    const first = await customers.list({ limit: 1 });
    clock.advance(1_000);
    const newest = await createCustomer({ billableId: 'newest' });

    const second = await customers.list({ limit: 2, cursor: first.nextCursor ?? undefined });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.billableId).toBe('oldest');
    expect(second.items.some(({ id }) => id === newest.id)).toBe(false);
  });

  it('includes only safe binding metadata when requested', async () => {
    const customer = await createCustomer({ billableId: 'bound' });
    const stripeBinding = await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_safe',
    });
    const paddleBinding = await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'paddle',
      providerCustomerId: 'ctm_safe',
    });
    const customers = createTenantPayable().customers(undefined, 'tenant-a');

    expect((await customers.list()).items[0]).not.toHaveProperty('bindings');
    expect((await customers.list({ includeBindings: true })).items[0]?.bindings).toEqual([
      { id: paddleBinding.id, provider: 'paddle', providerCustomerId: 'ctm_safe' },
      { id: stripeBinding.id, provider: 'stripe', providerCustomerId: 'cus_safe' },
    ]);
  });

  it('requires a tenant and rejects malformed cursors when tenancy is enabled', async () => {
    const payable = createTenantPayable();

    expect(() => payable.customers()).toThrow(expect.objectContaining({ code: 'TENANT_REQUIRED' }));
    await expect(
      payable.customers(undefined, 'tenant-a').list({ cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ code: 'COLLECTION_CURSOR_INVALID' });
  });

  it('rejects page sizes above one hundred customers', async () => {
    await expect(
      createTenantPayable().customers(undefined, 'tenant-a').list({ limit: 101 }),
    ).rejects.toMatchObject({ code: 'COLLECTION_LIMIT_INVALID' });
  });

  it('rejects a customer cursor when search filters change', async () => {
    await createCustomer({ billableId: 'one', email: 'ada@example.com' });
    await createCustomer({ billableId: 'two', email: 'ada@example.com' });
    const customers = createTenantPayable().customers(undefined, 'tenant-a');
    const first = await customers.list({ limit: 1, email: 'ada' });

    await expect(
      customers.list({ limit: 1, email: 'grace', cursor: first.nextCursor ?? undefined }),
    ).rejects.toMatchObject({ code: 'COLLECTION_CURSOR_INVALID' });
  });
});
