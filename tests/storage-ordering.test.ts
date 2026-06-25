import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb, makeCustomer } from './support/knex';

let db: Knex;
let clock: FakeClock;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
});

afterEach(async () => {
  await db.destroy();
});

describe('storage list ordering and batch insert (perf)', () => {
  it('lists rows newest first', async () => {
    const customer = await storage.customers.create(makeCustomer());
    const base = {
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      status: 'succeeded' as const,
      currency: 'USD',
      amount: 100,
      refundedAmount: 0,
      description: null,
    };
    await storage.payments.create({ ...base, providerPaymentId: 'pi_a', reference: 'a' });
    clock.advance(1000);
    await storage.payments.create({ ...base, providerPaymentId: 'pi_b', reference: 'b' });

    const list = await storage.payments.listByCustomer(customer.id);
    expect(list.map((payment) => payment.reference)).toEqual(['b', 'a']);
  });

  it('treats a non-positive limit as the default instead of returning nothing', async () => {
    const customer = await storage.customers.create(makeCustomer());
    const base = {
      tenantId: null,
      customerId: customer.id,
      provider: 'stripe',
      status: 'succeeded' as const,
      currency: 'USD',
      amount: 100,
      refundedAmount: 0,
      description: null,
    };
    await storage.payments.create({ ...base, providerPaymentId: 'pi_a', reference: 'a' });
    await storage.payments.create({ ...base, providerPaymentId: 'pi_b', reference: 'b' });

    expect(await storage.payments.listByCustomer(customer.id, null, { limit: 0 })).toHaveLength(2);
    expect(await storage.payments.listByCustomer(customer.id, null, { limit: -5 })).toHaveLength(2);
  });

  it('batch-inserts subscription items in a single call', async () => {
    const subscription = await storage.subscriptions.create({
      tenantId: null,
      customerId: 'cus_x',
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_x',
      status: 'active',
      priceId: null,
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    await storage.subscriptionItems.createMany([
      { subscriptionId: subscription.id, priceId: 'p1', providerItemId: null, quantity: 1 },
      { subscriptionId: subscription.id, priceId: 'p2', providerItemId: null, quantity: 2 },
      { subscriptionId: subscription.id, priceId: 'p3', providerItemId: null, quantity: 3 },
    ]);

    const items = await storage.subscriptionItems.listBySubscription(subscription.id);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.priceId).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('updatePrimary deterministically targets the lowest-id item among created_at ties', async () => {
    const subscription = await storage.subscriptions.create({
      tenantId: null,
      customerId: 'cus_tie',
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_tie',
      status: 'active',
      priceId: null,
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    await storage.subscriptionItems.createMany([
      { subscriptionId: subscription.id, priceId: 'p1', providerItemId: null, quantity: 1 },
      { subscriptionId: subscription.id, priceId: 'p2', providerItemId: null, quantity: 1 },
      { subscriptionId: subscription.id, priceId: 'p3', providerItemId: null, quantity: 1 },
    ]);

    await storage.subscriptionItems.updatePrimary(subscription.id, { quantity: 99 });

    const items = await storage.subscriptionItems.listBySubscription(subscription.id);
    const updated = items.filter((item) => item.quantity === 99);
    const lowestId = [...items].map((item) => item.id).sort()[0];
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe(lowestId);
  });

  it('rejects a duplicate customer for the same billable under a null tenant', async () => {
    await storage.customers.create(makeCustomer({ tenantId: null }));
    await expect(
      storage.customers.create(makeCustomer({ tenantId: null, providerCustomerId: 'cus_dup' })),
    ).rejects.toThrow();
  });

  it('still rejects a duplicate customer for the same tenant and billable', async () => {
    await storage.customers.create(makeCustomer({ tenantId: 'tenant-a' }));
    await expect(
      storage.customers.create(makeCustomer({ tenantId: 'tenant-a', providerCustomerId: 'cus_2' })),
    ).rejects.toThrow();
  });

  it('rejects a refund that references a missing payment', async () => {
    await expect(
      storage.refunds.create({
        tenantId: null,
        paymentId: 'missing_payment',
        provider: 'stripe',
        providerRefundId: 're_x',
        status: 'succeeded',
        currency: 'USD',
        amount: 100,
        reason: null,
      }),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});
