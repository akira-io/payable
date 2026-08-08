import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = {
  billableType: 'User',
  billableId: 'customer-1',
  email: 'customer@example.com',
  name: 'Customer',
};

describe('customer provider synchronization boundaries', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('keeps independent bindings and sync states for registered provider account names', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const payable = createPayable({
      providers: {
        'stripe-eu': new FakeProvider('cus_eu'),
        'stripe-us': new FakeProvider('cus_us'),
      },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const customer = await payable.customers().create(billable);

    await payable.customers('stripe-eu').sync(billable);
    await payable.customers('stripe-us').sync(billable);

    expect(await payable.customers('stripe-eu').binding(billable)).toMatchObject({
      customerId: customer.id,
      provider: 'stripe-eu',
      providerCustomerId: 'cus_eu',
    });
    expect(await payable.customers('stripe-us').binding(billable)).toMatchObject({
      customerId: customer.id,
      provider: 'stripe-us',
      providerCustomerId: 'cus_us',
    });
    expect(await payable.customers('stripe-eu').syncState(billable)).toMatchObject({
      status: 'synchronized',
      providerCustomerId: 'cus_eu',
    });
    expect(await payable.customers('stripe-us').syncState(billable)).toMatchObject({
      status: 'synchronized',
      providerCustomerId: 'cus_us',
    });
  });

  it('isolates synchronization lifecycle by tenant', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider();
    let providerSequence = 0;
    provider.createCustomer = async (input) => {
      providerSequence += 1;
      return {
        providerCustomerId: `cus_tenant_${providerSequence}`,
        email: input.email,
        name: input.name ?? null,
      };
    };
    const payable = createPayable({
      tenant: { enabled: true },
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const tenantA = payable.customers('stripe', 'tenant-a');
    const tenantB = payable.customers('stripe', 'tenant-b');

    const customerA = await tenantA.create(billable);
    const customerB = await tenantB.create(billable);
    await tenantA.sync(billable);
    await tenantB.sync(billable);

    expect(customerA.id).not.toBe(customerB.id);
    expect(await tenantA.syncState(billable)).toMatchObject({
      tenantId: 'tenant-a',
      customerId: customerA.id,
      providerCustomerId: 'cus_tenant_1',
    });
    expect(await tenantB.syncState(billable)).toMatchObject({
      tenantId: 'tenant-b',
      customerId: customerB.id,
      providerCustomerId: 'cus_tenant_2',
    });
  });

  it('requires an explicit customer-capable provider before recording an attempt', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('customers');
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    await payable.customers().create(billable);

    expect(() => payable.customers().sync(billable)).toThrow(
      expect.objectContaining({ code: 'CUSTOMER_PROVIDER_REQUIRED' }),
    );
    await expect(payable.customers('stripe').sync(billable)).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
    });
    expect(await payable.customers('stripe').syncState(billable)).toBeNull();
    expect(provider.createCustomerCalls).toBe(0);
  });

  it('converges on a competing durable binding after remote-create reconciliation', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_losing');
    const storage = new KnexStorageDriver(database, new FakeClock());
    const bindings = storage.customerProviderBindings;
    let rejectBinding = true;
    storage.customerProviderBindings = {
      ...bindings,
      create: async (data) => {
        if (rejectBinding) {
          rejectBinding = false;
          throw new Error('binding unavailable');
        }
        return bindings.create(data);
      },
      findByCustomerAndProvider: (...args) => bindings.findByCustomerAndProvider(...args),
      findByProviderId: (...args) => bindings.findByProviderId(...args),
    };
    const customers = createPayable({ providers: { stripe: provider }, storage }).customers(
      'stripe',
    );
    const customer = await customers.create(billable);
    await expect(customers.sync(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_PROVIDER_BINDING_PERSISTENCE_FAILED',
    });
    await bindings.create({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_winner',
    });

    await expect(customers.sync(billable)).resolves.toBe('cus_winner');

    expect(provider.createCustomerCalls).toBe(1);
    expect(provider.lastUpdateCustomer?.providerCustomerId).toBe('cus_winner');
    expect(await customers.syncState(billable)).toMatchObject({
      status: 'synchronized',
      providerCustomerId: 'cus_winner',
      attempts: 2,
    });
  });

  it('keeps explicit synchronization compatible with storage drivers without lifecycle state', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const legacyStorage = Object.create(storage) as KnexStorageDriver;
    Object.defineProperty(legacyStorage, 'customerProviderSyncStates', { value: undefined });
    Object.defineProperty(legacyStorage, 'transaction', {
      value: async <T>(work: (repositories: KnexStorageDriver) => Promise<T>) =>
        work(legacyStorage),
    });
    const customers = createPayable({
      providers: { stripe: new FakeProvider('cus_legacy') },
      storage: legacyStorage,
    }).customers('stripe');
    await customers.create(billable);

    await expect(customers.sync(billable)).resolves.toBe('cus_legacy');
    await expect(customers.syncState(billable)).resolves.toBeNull();
  });

  it('blocks duplicate creates after an ambiguous failure without native idempotency', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = Object.assign(new FakeProvider(), {
      customerCreateIdempotency: 'unsupported' as const,
    });
    provider.createCustomer = async () => {
      provider.createCustomerCalls += 1;
      throw Object.assign(new Error('response lost after create'), { code: 'ECONNRESET' });
    };
    const storage = new KnexStorageDriver(database, new FakeClock());
    const customers = createPayable({
      providers: { paddle: provider },
      storage,
    }).customers('paddle');
    const customer = await customers.create(billable);

    await expect(customers.sync(billable)).rejects.toThrow('response lost after create');
    await expect(customers.syncState(billable)).resolves.toMatchObject({
      status: 'reconciliation_required',
      providerCustomerId: null,
      attempts: 1,
      failureCode: 'ECONNRESET',
    });

    await expect(customers.sync(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_PROVIDER_RECONCILIATION_REQUIRED',
    });
    expect(provider.createCustomerCalls).toBe(1);
    await expect(customers.syncState(billable)).resolves.toMatchObject({ attempts: 1 });

    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'paddle',
      providerCustomerId: 'ctm_manually_reconciled',
    });
    await expect(customers.sync(billable)).resolves.toBe('ctm_manually_reconciled');
    expect(provider.createCustomerCalls).toBe(1);
    await expect(customers.syncState(billable)).resolves.toMatchObject({
      status: 'synchronized',
      attempts: 2,
      providerCustomerId: 'ctm_manually_reconciled',
    });
  });
});
