import { describe, expect, it } from 'vitest';
import { CreateSubscriptionAction } from '../src/application/actions/subscriptions/create-subscription.action';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('subscription storage', () => {
  it('writes an audit log atomically when swapping a plan', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const created = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .create();

    await payable.customer(billable).subscription('default').swap('price_business');

    const logs = await storage.auditLogs.list({
      resourceType: 'subscription',
      resourceId: created.id,
    });
    expect(logs.some((log) => log.action === 'subscription.swapped')).toBe(true);
    await db.destroy();
  });

  it('writes an audit log atomically when canceling and resuming', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const created = await payable
      .customer(billable)
      .newSubscription('default')
      .price('price_pro')
      .create();

    await payable.customer(billable).subscription('default').cancel();
    await payable.customer(billable).subscription('default').resume();
    await payable.customer(billable).subscription('default').cancelNow();

    const actions = (
      await storage.auditLogs.list({ resourceType: 'subscription', resourceId: created.id })
    ).map((log) => log.action);
    expect(actions).toContain('subscription.canceled');
    expect(actions).toContain('subscription.resumed');
    expect(actions).toContain('subscription.canceled_now');
    await db.destroy();
  });

  it('derives the header price and quantity from the primary line item', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const provider = new FakeProvider();
    await storage.customers.create({
      tenantId: null,
      billableType: 'User',
      billableId: '1',
      email: 'user@example.com',
      name: 'User',
      metadata: null,
    });
    const action = new CreateSubscriptionAction({
      provider,
      providerName: 'stripe',
      clock: new FakeClock(),
      storage,
    });

    const created = await action.handle({
      billable,
      name: 'default',
      priceId: 'price_top',
      quantity: 9,
      items: [
        { priceId: 'price_primary', quantity: 2 },
        { priceId: 'price_addon', quantity: 1 },
      ],
    });

    expect(created.priceId).toBe('price_primary');
    expect(created.quantity).toBe(2);
    await db.destroy();
  });

  it('scopes findByName to the owning tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db, new FakeClock());
    const customer = await storage.customers.create({
      tenantId: 'tenant-a',
      billableType: 'User',
      billableId: '1',
      email: 'a@example.com',
      name: 'A',
      metadata: null,
    });
    await storage.subscriptions.create({
      tenantId: 'tenant-a',
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_a',
      status: 'active',
      priceId: 'price_pro',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });

    expect(
      await storage.subscriptions.findByName(customer.id, 'default', 'tenant-a'),
    ).not.toBeNull();
    expect(await storage.subscriptions.findByName(customer.id, 'default', 'tenant-b')).toBeNull();
    await db.destroy();
  });
});
