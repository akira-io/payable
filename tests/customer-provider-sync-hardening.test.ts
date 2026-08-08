import { afterEach, describe, expect, it } from 'vitest';
import { CustomerProviderSyncLifecycle } from '../src/application/services/customers/customer-provider-sync-lifecycle';
import { createPayable } from '../src/create-payable';
import { CustomerProviderBindingConflictError } from '../src/domain/errors/customer-provider-binding-conflict.error';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = {
  billableType: 'User',
  billableId: 'post-merge-hardening',
  email: 'customer@example.com',
  name: 'Customer',
};

describe('customer provider synchronization hardening', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('requires manual reconciliation when a non-native create lease expires', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock();
    const provider = Object.assign(new FakeProvider(), {
      customerCreateIdempotency: 'unsupported' as const,
    });
    let notifyCreateStarted: () => void = () => undefined;
    let releaseCreate: () => void = () => undefined;
    const createStarted = new Promise<void>((resolve) => {
      notifyCreateStarted = resolve;
    });
    const createRelease = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    provider.createCustomer = async (input) => {
      provider.createCustomerCalls += 1;
      if (provider.createCustomerCalls === 1) {
        notifyCreateStarted();
        await createRelease;
      }
      return {
        providerCustomerId: `cus_non_native_${provider.createCustomerCalls}`,
        email: input.email,
        name: input.name ?? null,
      };
    };
    const storage = new KnexStorageDriver(database, clock);
    const customers = createPayable({
      providers: { paddle: provider },
      storage,
      clock,
    }).customers('paddle');
    await customers.create(billable);
    const original = customers.sync(billable);
    await createStarted;
    clock.advance(30_001);

    const retryResult = await customers.sync(billable).catch((error: unknown) => error);

    expect(retryResult).toMatchObject({ code: 'CUSTOMER_PROVIDER_RECONCILIATION_REQUIRED' });
    expect(provider.createCustomerCalls).toBe(1);
    await expect(customers.syncState(billable)).resolves.toMatchObject({
      status: 'reconciliation_required',
      attempts: 1,
      failureCode: 'CUSTOMER_PROVIDER_SYNC_LEASE_EXPIRED',
    });
    releaseCreate();
    await expect(original).resolves.toBe('cus_non_native_1');
  });

  it('records the losing remote id when its current attempt loses the binding race', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock();
    const provider = new FakeProvider();
    const storage = new KnexStorageDriver(database, clock);
    const customers = createPayable({ providers: { stripe: provider }, storage, clock }).customers(
      'stripe',
    );
    const customer = await customers.create(billable);
    await storage.customerProviderBindings.create({
      customerId: customer.id,
      provider: 'stripe',
      providerCustomerId: 'cus_winner',
    });
    const lifecycle = new CustomerProviderSyncLifecycle({
      provider,
      providerName: 'stripe',
      storage,
      clock,
    });
    const losingAttempt = await lifecycle.begin(customer.id);
    await lifecycle.reconciliationRequired(
      customer.id,
      'cus_orphan',
      losingAttempt,
      new CustomerProviderBindingConflictError('stripe', 'cus_orphan', 'cus_winner'),
    );

    await expect(
      storage.auditLogs.list({ resourceType: 'customer', resourceId: customer.id }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'customer.provider.orphaned',
          metadata: expect.objectContaining({ providerCustomerId: 'cus_orphan' }),
        }),
      ]),
    );
    await expect(storage.outboxEvents.claimPending(10)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'customer.provider.orphaned.v1',
          payload: expect.objectContaining({ providerCustomerId: 'cus_orphan' }),
        }),
      ]),
    );
    const repairAttempt = await lifecycle.begin(customer.id, true);
    await lifecycle.synchronized(customer.id, 'cus_winner', repairAttempt);
    await expect(
      storage.auditLogs.list({ resourceType: 'customer', resourceId: customer.id }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'customer.provider.orphaned',
          metadata: expect.objectContaining({ providerCustomerId: 'cus_orphan' }),
        }),
      ]),
    );
  });
});
