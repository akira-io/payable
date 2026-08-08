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
});
