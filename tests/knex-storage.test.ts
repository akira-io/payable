import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb, makeCustomer } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  storage = new KnexStorageDriver(db, new FakeClock(new Date('2026-06-22T00:00:00.000Z')));
});

afterEach(async () => {
  await db.destroy();
});

describe('KnexStorageDriver customers', () => {
  it('creates and reads back a customer with json metadata', async () => {
    const created = await storage.customers.create(makeCustomer({ metadata: { plan: 'pro' } }));
    expect(created.id).toBeTruthy();
    expect(created.createdAt.toISOString()).toBe('2026-06-22T00:00:00.000Z');

    expect((await storage.customers.findById(created.id))?.metadata).toEqual({ plan: 'pro' });
    expect((await storage.customers.findByBillable('User', '1'))?.id).toBe(created.id);
    expect((await db('payable_customers').where({ id: created.id }).first())?.tenant_key).toBe('');
  });

  it('keeps the physical tenant key aligned with a customer tenant', async () => {
    const created = await storage.customers.create(makeCustomer({ tenantId: 'tenant-a' }));

    expect((await db('payable_customers').where({ id: created.id }).first())?.tenant_key).toBe(
      'tenant-a',
    );
  });

  it('updates only the provided fields', async () => {
    const created = await storage.customers.create(makeCustomer());
    const updated = await storage.customers.update(created.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.email).toBe('user@example.com');
  });

  it('creates a customer in a single round-trip via RETURNING', async () => {
    const statements: string[] = [];
    db.on('query', (query: { sql: string }) => statements.push(query.sql));
    await storage.customers.create(makeCustomer());
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/insert/i);
  });

  it('enforces one customer per billable per tenant', async () => {
    await storage.customers.create(makeCustomer({ tenantId: 'tenant-a' }));
    await expect(
      storage.customers.create(makeCustomer({ tenantId: 'tenant-a' })),
    ).rejects.toThrow();
  });

  it('matches a billable lookup regardless of null versus empty-string tenant', async () => {
    const nullTenant = await storage.customers.create(
      makeCustomer({ tenantId: null, billableId: 'n1' }),
    );
    expect((await storage.customers.findByBillable('User', 'n1', null))?.id).toBe(nullTenant.id);
    expect((await storage.customers.findByBillable('User', 'n1', ''))?.id).toBe(nullTenant.id);

    const emptyTenant = await storage.customers.create(
      makeCustomer({ tenantId: '', billableId: 'e1' }),
    );
    expect((await storage.customers.findByBillable('User', 'e1', null))?.id).toBe(emptyTenant.id);
    expect((await storage.customers.findByBillable('User', 'e1', ''))?.id).toBe(emptyTenant.id);
  });
});

describe('KnexStorageDriver catalog', () => {
  it('returns a tenant-scoped product when insert RETURNING is unavailable', async () => {
    const fallbackStorage = new KnexStorageDriver(
      withoutInsertReturning(db),
      new FakeClock(new Date('2026-06-22T00:00:00.000Z')),
    );

    const product = await fallbackStorage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_no_returning',
      name: 'No RETURNING product',
      description: null,
      active: true,
      metadata: null,
    });

    expect(product).toMatchObject({
      tenantId: 'tenant-a',
      providerProductId: 'prod_no_returning',
    });
    expect(await fallbackStorage.products.findById(product.id, 'tenant-a')).toMatchObject({
      id: product.id,
    });
  });

  it('returns a tenant-scoped price when insert RETURNING is unavailable', async () => {
    const product = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_price_no_returning',
      name: 'No RETURNING price product',
      description: null,
      active: true,
      metadata: null,
    });
    const fallbackStorage = new KnexStorageDriver(
      withoutInsertReturning(db),
      new FakeClock(new Date('2026-06-22T00:00:00.000Z')),
    );

    const price = await fallbackStorage.prices.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerPriceId: 'price_no_returning',
      productId: product.id,
      currency: 'USD',
      unitAmount: 9900,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });

    expect(price).toMatchObject({ tenantId: 'tenant-a', providerPriceId: 'price_no_returning' });
    expect(await fallbackStorage.prices.findById(price.id, 'tenant-a')).toMatchObject({
      id: price.id,
    });
  });

  it('links prices to products and subscriptions to customers', async () => {
    const product = await storage.products.create({
      tenantId: null,
      provider: 'stripe',
      providerProductId: 'prod_1',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    expect(product.active).toBe(true);

    const price = await storage.prices.create({
      tenantId: null,
      provider: 'stripe',
      providerPriceId: 'price_1',
      productId: product.id,
      currency: 'USD',
      unitAmount: 9900,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });
    expect(await storage.prices.listByProduct(product.id, null)).toHaveLength(1);

    const customer = await storage.customers.create(makeCustomer());
    const subscription = await storage.subscriptions.create({
      tenantId: null,
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_1',
      status: 'active',
      priceId: price.id,
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    expect((await storage.subscriptions.findByName(customer.id, 'default'))?.id).toBe(
      subscription.id,
    );
    expect(await storage.subscriptions.listByCustomer(customer.id)).toHaveLength(1);
  });

  it('normalizes a stored currency code on read', async () => {
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_norm',
      status: 'succeeded',
      currency: 'usd',
      amount: 100,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    expect(payment.currency).toBe('USD');
    expect((await storage.payments.findById(payment.id))?.currency).toBe('USD');
  });

  it('caps an unbounded list at the default limit', async () => {
    for (let i = 0; i < 105; i += 1) {
      await storage.payments.create({
        tenantId: null,
        customerId: 'cus_cap',
        provider: 'stripe',
        providerPaymentId: `pi_cap_${i}`,
        status: 'succeeded',
        currency: 'USD',
        amount: 100,
        refundedAmount: 0,
        reference: null,
        description: null,
      });
    }
    expect(await storage.payments.listByCustomer('cus_cap')).toHaveLength(100);
    expect(await storage.payments.listByCustomer('cus_cap', null, { limit: 5 })).toHaveLength(5);
  });

  it('stores money amounts beyond the 32-bit integer range', async () => {
    const large = 5_000_000_000;
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_big',
      status: 'succeeded',
      currency: 'USD',
      amount: large,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    expect((await storage.payments.findById(payment.id))?.amount).toBe(large);
  });
});

function withoutInsertReturning(knex: Knex): Knex {
  return new Proxy(knex, {
    apply(target, thisArgument, argumentsList) {
      const query = Reflect.apply(target, thisArgument, argumentsList) as Knex.QueryBuilder;
      const returningOverride = query as unknown as {
        returning(): Promise<unknown[]>;
      };
      returningOverride.returning = async () => {
        await query;
        return [];
      };
      return query;
    },
  });
}

describe('KnexStorageDriver transactions', () => {
  it('commits work on success', async () => {
    await storage.transaction(async (repositories) => {
      const customer = await repositories.customers.create(makeCustomer());
      await repositories.customerProviderBindings.create({
        customerId: customer.id,
        provider: 'stripe',
        providerCustomerId: 'cus_commit',
      });
    });
    expect(
      await storage.customerProviderBindings.findByProviderId('stripe', 'cus_commit', null),
    ).not.toBeNull();
  });

  it('rolls back work on failure', async () => {
    await expect(
      storage.transaction(async (repositories) => {
        const customer = await repositories.customers.create(makeCustomer());
        await repositories.customerProviderBindings.create({
          customerId: customer.id,
          provider: 'stripe',
          providerCustomerId: 'cus_rollback',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(
      await storage.customerProviderBindings.findByProviderId('stripe', 'cus_rollback', null),
    ).toBeNull();
  });
});
