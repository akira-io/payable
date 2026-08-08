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

describe('customer provider synchronization', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('synchronizes explicitly and persists the provider lifecycle separately from the binding', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_explicit');
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });

    const customer = await payable.customers().create(billable);
    expect(provider.createCustomerCalls).toBe(0);
    expect(await payable.customers('stripe').syncState(billable)).toBeNull();

    await expect(payable.customers('stripe').sync(billable)).resolves.toBe('cus_explicit');

    expect(await payable.customers('stripe').binding(billable)).toMatchObject({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_explicit',
    });
    expect(await payable.customers('stripe').syncState(billable)).toMatchObject({
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      status: 'synchronized',
      providerCustomerId: 'cus_explicit',
      attempts: 1,
      failureCode: null,
    });
  });

  it('updates the bound provider from canonical local customer data', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_bound');
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const customers = payable.customers('stripe');
    await customers.create(billable);
    await customers.sync(billable);
    await customers.update(billable, {
      email: 'NEW@Example.COM',
      name: 'Canonical Name',
    });

    await customers.sync({ ...billable, email: 'stale@example.com', name: 'Stale Name' });

    expect(provider.createCustomerCalls).toBe(1);
    expect(provider.lastUpdateCustomer).toEqual({
      providerCustomerId: 'cus_bound',
      email: 'new@example.com',
      name: 'Canonical Name',
    });
    expect(await customers.syncState(billable)).toMatchObject({
      status: 'synchronized',
      attempts: 2,
    });
  });

  it('records provider failures and retries without changing the canonical customer', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_retry');
    const originalCreate = provider.createCustomer.bind(provider);
    let attempts = 0;
    provider.createCustomer = async (input, context) => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('secret provider response'), { code: 'ECONNRESET' });
      }
      return originalCreate(input, context);
    };
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const customers = payable.customers('stripe');
    const customer = await customers.create(billable);

    await expect(customers.sync(billable)).rejects.toThrow('secret provider response');

    expect(await customers.get(billable)).toEqual(customer);
    expect(await customers.binding(billable)).toBeNull();
    expect(await customers.syncState(billable)).toMatchObject({
      status: 'failed',
      providerCustomerId: null,
      attempts: 1,
      failureCode: 'ECONNRESET',
    });

    await expect(customers.sync(billable)).resolves.toBe('cus_retry');
    expect(attempts).toBe(2);
    expect(await customers.syncState(billable)).toMatchObject({
      status: 'synchronized',
      attempts: 2,
      failureCode: null,
    });
  });

  it('reconciles a remote create after local binding persistence fails', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_reconcile');
    const storage = new KnexStorageDriver(database, new FakeClock());
    const originalBindings = storage.customerProviderBindings;
    let rejectBinding = true;
    storage.customerProviderBindings = {
      ...originalBindings,
      create: async (data) => {
        if (rejectBinding) {
          rejectBinding = false;
          throw new Error('database unavailable');
        }
        return originalBindings.create(data);
      },
      findByCustomerAndProvider: (...args) => originalBindings.findByCustomerAndProvider(...args),
      findByProviderId: (...args) => originalBindings.findByProviderId(...args),
    };
    const customers = createPayable({ providers: { stripe: provider }, storage }).customers(
      'stripe',
    );
    await customers.create(billable);

    await expect(customers.sync(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_PROVIDER_BINDING_PERSISTENCE_FAILED',
    });
    expect(await customers.binding(billable)).toBeNull();
    expect(await customers.syncState(billable)).toMatchObject({
      status: 'reconciliation_required',
      providerCustomerId: 'cus_reconcile',
      attempts: 1,
      failureCode: 'CUSTOMER_PROVIDER_BINDING_PERSISTENCE_FAILED',
    });

    await expect(customers.sync(billable)).resolves.toBe('cus_reconcile');

    expect(provider.createCustomerCalls).toBe(1);
    expect(await customers.binding(billable)).toMatchObject({
      providerCustomerId: 'cus_reconcile',
    });
    expect(await customers.syncState(billable)).toMatchObject({
      status: 'synchronized',
      providerCustomerId: 'cus_reconcile',
      attempts: 2,
      failureCode: null,
    });
  });

  it('records synchronized customer transitions in the audit log and outbox', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const customers = createPayable({
      providers: { stripe: new FakeProvider('cus_events') },
      storage,
    }).customers('stripe');
    const customer = await customers.create(billable);

    await customers.sync(billable);

    expect(
      await storage.auditLogs.list({ resourceType: 'customer', resourceId: customer.id }),
    ).toEqual([
      expect.objectContaining({
        action: 'customer.provider.synchronized',
        resourceType: 'customer',
        resourceId: customer.id,
        metadata: { provider: 'stripe', providerCustomerId: 'cus_events' },
      }),
    ]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([
      expect.objectContaining({
        eventType: 'customer.provider.synchronized.v1',
        payload: expect.objectContaining({
          customerId: customer.id,
          provider: 'stripe',
          providerCustomerId: 'cus_events',
          tenantId: null,
        }),
      }),
    ]);
  });

  it('keeps the binding and records a failed provider update for retry', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_update_failure');
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const customers = payable.customers('stripe');
    await customers.create(billable);
    await customers.sync(billable);
    await customers.update(billable, { name: 'Local Name' });
    provider.updateCustomer = async () => {
      throw Object.assign(new Error('provider unavailable'), { code: 'ETIMEDOUT' });
    };

    await expect(customers.sync(billable)).rejects.toThrow('provider unavailable');

    expect(await customers.binding(billable)).toMatchObject({
      providerCustomerId: 'cus_update_failure',
    });
    expect((await customers.get(billable))?.name).toBe('Local Name');
    expect(await customers.syncState(billable)).toMatchObject({
      status: 'failed',
      providerCustomerId: 'cus_update_failure',
      attempts: 2,
      failureCode: 'ETIMEDOUT',
    });
  });
});
