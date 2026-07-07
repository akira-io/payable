import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { ProviderCapabilityNotSupportedError } from '../src/domain/errors/provider-capability-not-supported.error';
import { IdempotencyKey } from '../src/domain/value-objects/idempotency-key';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('payable.customers', () => {
  it('creates a customer at the provider and persists it', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const customer = await payable.customers().create(billable);

    expect(provider.createCustomerCalls).toBe(1);
    expect(customer.providerCustomerId).toBe('cus_fake');
    expect(customer.email).toBe('user@example.com');
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

  it('is idempotent: a second create returns the existing customer', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const first = await payable.customers().create(billable);
    const second = await payable.customers().create(billable);

    expect(provider.createCustomerCalls).toBe(1);
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
    await payable.customers().create(billable);
    expect((await payable.customers().get(billable))?.providerCustomerId).toBe('cus_fake');
    await db.destroy();
  });

  it('updates a customer through the provider and persists the change', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    await payable.customers().create(billable);
    const updated = await payable.customers().update(billable, { name: 'Renamed' });

    expect(provider.lastUpdateCustomer?.providerCustomerId).toBe('cus_fake');
    expect(updated.name).toBe('Renamed');
    await db.destroy();
  });

  it('rejects provider-backed updates when the provider declares customers without the update method', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    await payable.customers().create(billable);
    Object.defineProperty(provider, 'updateCustomer', { value: undefined });

    await expect(payable.customers().update(billable, { name: 'Renamed' })).rejects.toBeInstanceOf(
      ProviderCapabilityNotSupportedError,
    );
    expect((await payable.customers().get(billable))?.name).toBe('User');
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
    expect(customer.providerCustomerId).toBeNull();
    expect(customer.email).toBe('user@example.com');

    const updated = await payable.customers().update(billable, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.providerCustomerId).toBeNull();
    await db.destroy();
  });
});
