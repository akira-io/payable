import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = {
  billableType: 'User',
  billableId: 'single-flight',
  email: 'customer@example.com',
  name: 'Customer',
};

describe('customer provider create single-flight', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('makes concurrent sync callers share one remote create', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_single_flight');
    let createCalls = 0;
    let notifyCreateStarted: () => void = () => undefined;
    let releaseCreate: () => void = () => undefined;
    const createStarted = new Promise<void>((resolve) => {
      notifyCreateStarted = resolve;
    });
    const createRelease = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    provider.createCustomer = async (input) => {
      createCalls += 1;
      notifyCreateStarted();
      await createRelease;
      return {
        providerCustomerId: 'cus_single_flight',
        email: input.email,
        name: input.name ?? null,
      };
    };
    const storage = new KnexStorageDriver(database, new FakeClock());
    const beginAttempt = storage.customerProviderSyncStates.beginAttempt.bind(
      storage.customerProviderSyncStates,
    );
    let beginCalls = 0;
    let notifyFollowerClaimed: () => void = () => undefined;
    const followerClaimed = new Promise<void>((resolve) => {
      notifyFollowerClaimed = resolve;
    });
    storage.customerProviderSyncStates.beginAttempt = async (input) => {
      const claim = await beginAttempt(input);
      beginCalls += 1;
      if (beginCalls === 2) {
        notifyFollowerClaimed();
      }
      return claim;
    };
    const customers = createPayable({
      providers: { stripe: provider },
      storage,
    }).customers('stripe');
    await customers.create(billable);

    const winner = customers.sync(billable);
    await createStarted;
    const follower = customers.sync(billable);
    await followerClaimed;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createCalls).toBe(1);
    releaseCreate();

    await expect(Promise.all([winner, follower])).resolves.toEqual([
      'cus_single_flight',
      'cus_single_flight',
    ]);
    expect(createCalls).toBe(1);
  });

  it('reuses a binding completed while a follower is claiming the next attempt', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider('cus_claim_race');
    let releaseCreate: () => void = () => undefined;
    const createRelease = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    provider.createCustomer = async (input) => {
      provider.createCustomerCalls += 1;
      await createRelease;
      return { providerCustomerId: 'cus_claim_race', email: input.email, name: input.name ?? null };
    };
    const storage = new KnexStorageDriver(database, new FakeClock());
    const beginAttempt = storage.customerProviderSyncStates.beginAttempt.bind(
      storage.customerProviderSyncStates,
    );
    let beginCalls = 0;
    let notifyFollowerClaiming: () => void = () => undefined;
    let releaseFollowerClaim: () => void = () => undefined;
    const followerClaiming = new Promise<void>((resolve) => {
      notifyFollowerClaiming = resolve;
    });
    const followerClaimRelease = new Promise<void>((resolve) => {
      releaseFollowerClaim = resolve;
    });
    storage.customerProviderSyncStates.beginAttempt = async (input) => {
      beginCalls += 1;
      if (beginCalls === 2) {
        notifyFollowerClaiming();
        await followerClaimRelease;
      }
      return beginAttempt(input);
    };
    const customers = createPayable({ providers: { stripe: provider }, storage }).customers(
      'stripe',
    );
    await customers.create(billable);

    const winner = customers.sync(billable);
    await Promise.resolve();
    const follower = customers.sync(billable);
    await followerClaiming;
    releaseCreate();
    await expect(winner).resolves.toBe('cus_claim_race');
    releaseFollowerClaim();

    await expect(follower).resolves.toBe('cus_claim_race');
    expect(provider.createCustomerCalls).toBe(1);
  });

  it('records a late remote customer after an expired lease loses the binding', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock();
    const provider = new FakeProvider();
    let createCalls = 0;
    let notifyOlderStarted: () => void = () => undefined;
    let releaseOlder: () => void = () => undefined;
    const olderStarted = new Promise<void>((resolve) => {
      notifyOlderStarted = resolve;
    });
    const olderRelease = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    provider.createCustomer = async (input) => {
      createCalls += 1;
      if (createCalls === 1) {
        notifyOlderStarted();
        await olderRelease;
        return { providerCustomerId: 'cus_orphan', email: input.email, name: input.name ?? null };
      }
      return { providerCustomerId: 'cus_winner', email: input.email, name: input.name ?? null };
    };
    const storage = new KnexStorageDriver(database, clock);
    const customers = createPayable({ providers: { stripe: provider }, storage, clock }).customers(
      'stripe',
    );
    const customer = await customers.create(billable);

    const older = customers.sync(billable);
    await olderStarted;
    clock.advance(30_001);
    const newer = customers.sync(billable);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(createCalls).toBe(2);
    await expect(newer).resolves.toBe('cus_winner');
    releaseOlder();
    await expect(older).rejects.toMatchObject({ code: 'CUSTOMER_PROVIDER_BINDING_CONFLICT' });

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
  });

  it('requires lifecycle storage before a non-native remote create', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = Object.assign(new FakeProvider(), {
      customerCreateIdempotency: 'unsupported' as const,
    });
    const storage = new KnexStorageDriver(database, new FakeClock());
    const legacyStorage = Object.create(storage) as KnexStorageDriver;
    Object.defineProperty(legacyStorage, 'customerProviderSyncStates', { value: undefined });
    const customers = createPayable({
      providers: { paddle: provider },
      storage: legacyStorage,
    }).customers('paddle');
    await customers.create(billable);

    await expect(customers.sync(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_PROVIDER_DURABLE_SYNC_REQUIRED',
    });
    expect(provider.createCustomerCalls).toBe(0);
  });

  it('requires storage before a non-native remote create', async () => {
    const provider = Object.assign(new FakeProvider(), {
      customerCreateIdempotency: 'unsupported' as const,
    });
    const customers = createPayable({ providers: { paddle: provider } }).customers('paddle');

    await expect(customers.sync(billable)).rejects.toMatchObject({
      code: 'CUSTOMER_PROVIDER_DURABLE_SYNC_REQUIRED',
    });
    expect(provider.createCustomerCalls).toBe(0);
  });

  it('treats undeclared create idempotency as unsupported', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new FakeProvider();
    Object.defineProperty(provider, 'customerCreateIdempotency', { value: undefined });
    provider.createCustomer = async () => {
      provider.createCustomerCalls += 1;
      throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' });
    };
    const customers = createPayable({
      providers: { custom: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    }).customers('custom');
    await customers.create(billable);

    await expect(customers.sync(billable)).rejects.toThrow('response lost');
    await expect(customers.syncState(billable)).resolves.toMatchObject({
      status: 'reconciliation_required',
      attempts: 1,
    });
  });

  it('declares Stripe customer creation as natively idempotent', () => {
    const provider = new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' });

    expect(provider.customerCreateIdempotency).toBe('native');
  });
});
