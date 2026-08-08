import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { IdempotencyKey } from '../src/domain/value-objects/idempotency-key';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('payable.customers', () => {
  it('keeps logical customer CRUD local when no providers are registered', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const created = await payable.customers().create({
      ...billable,
      email: '  USER@Example.COM  ',
    });
    const updated = await payable.customers().update(billable, { name: 'Renamed' });

    expect(created.email).toBe('user@example.com');
    expect(updated.name).toBe('Renamed');
    expect(await payable.customers().get(billable)).toEqual(updated);
    expect(await payable.customers().find(created.id)).toEqual(updated);
    expect((await payable.customers().list()).items).toEqual([updated]);
    await db.destroy();
  });

  it('reads a named provider binding without resolving the provider', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create(billable);
    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'archived-account',
      providerCustomerId: 'cus_archived',
    });

    await expect(payable.customers('archived-account').binding(billable)).resolves.toMatchObject({
      provider: 'archived-account',
      providerCustomerId: 'cus_archived',
    });
    await db.destroy();
  });

  it('creates locally and synchronizes only when explicitly requested', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const customers = payable.customers('stripe');
    const customer = await customers.create(billable);

    expect(provider.createCustomerCalls).toBe(0);
    expect(customer.email).toBe('user@example.com');
    expect(await customers.binding(billable)).toBeNull();

    await customers.sync(billable);

    expect(provider.createCustomerCalls).toBe(1);
    expect(await customers.binding(billable)).toMatchObject({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_fake',
    });
    await db.destroy();
  });

  it('rejects an invalid email with a coded CUSTOMER_EMAIL_INVALID error', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    await expect(
      payable.customers().create({ ...billable, email: 'not-an-email' }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_EMAIL_INVALID' });
    await db.destroy();
  });

  it('returns the existing local customer without creating provider customers', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const first = await payable.customers().create(billable);
    const second = await payable.customers().create(billable);

    expect(provider.createCustomerCalls).toBe(0);
    expect(second.id).toBe(first.id);
    await db.destroy();
  });

  it('routes the first-time sync through the idempotency service when configured', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, clock),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });

    await payable.customers().create(billable);
    await payable.customers('stripe').sync(billable);

    const key = IdempotencyKey.forCustomer({
      tenantId: null,
      provider: 'stripe',
      billableType: 'User',
      billableId: '1',
    });
    const record = await new KnexIdempotencyRepository(db, clock).find(
      `customer:${key.toString()}`,
      undefined,
    );
    expect(provider.createCustomerCalls).toBe(1);
    expect(record?.status).toBe('completed');
    expect(record?.response).toBe('cus_fake');
    await db.destroy();
  });

  it('gets a customer by billable, returning null when absent', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    expect(await payable.customers().get(billable)).toBeNull();
    const customers = payable.customers('stripe');
    const created = await customers.create(billable);
    expect(await payable.customers().get(billable)).toEqual(created);
    expect(await customers.binding(billable)).toBeNull();
    await customers.sync(billable);
    expect((await customers.binding(billable))?.providerCustomerId).toBe('cus_fake');
    await db.destroy();
  });

  it('commits local updates before an explicit provider update', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const customers = payable.customers('stripe');
    await customers.create(billable);
    await customers.sync(billable);
    const updated = await customers.update(billable, { name: 'Renamed' });

    expect(provider.lastUpdateCustomer).toBeUndefined();
    expect(updated.name).toBe('Renamed');
    await customers.sync(billable);
    expect(provider.lastUpdateCustomer?.providerCustomerId).toBe('cus_fake');
    await db.destroy();
  });

  it('does not inspect provider methods during local updates', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    await payable.customers().create(billable);
    Object.defineProperty(provider, 'updateCustomer', { value: undefined });

    await expect(payable.customers().update(billable, { name: 'Renamed' })).resolves.toMatchObject({
      name: 'Renamed',
    });
    expect((await payable.customers().get(billable))?.name).toBe('Renamed');
    await db.destroy();
  });

  it('rejects an update for an unknown customer', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    await expect(payable.customers().update(billable, { name: 'X' })).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_FOUND',
    });
    await db.destroy();
  });

  it('requires a storage driver', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    await expect(payable.customers().create(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_STORAGE_REQUIRED',
    });
  });

  it('creates a local customer when the provider lacks the customers capability', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('customers');
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const customer = await payable.customers().create(billable);
    expect(customer.email).toBe('user@example.com');
    expect(await payable.customers('stripe').binding(billable)).toBeNull();

    const updated = await payable.customers().update(billable, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(await payable.customers('stripe').binding(billable)).toBeNull();
    await db.destroy();
  });
});
