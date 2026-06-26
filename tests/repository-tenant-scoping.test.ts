import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  storage = new KnexStorageDriver(db, new FakeClock());
});

afterEach(async () => {
  await db.destroy();
});

describe('findByProviderId tenant scoping', () => {
  it('scopes customer findByProviderId to the owning tenant', async () => {
    await storage.customers.create({
      tenantId: 'acme',
      provider: 'stripe',
      providerCustomerId: 'cus_1',
      billableType: 'User',
      billableId: '1',
      email: 'a@example.com',
      name: null,
      metadata: null,
    });
    expect(await storage.customers.findByProviderId('stripe', 'cus_1', 'globex')).toBeNull();
    expect(
      (await storage.customers.findByProviderId('stripe', 'cus_1', 'acme'))?.providerCustomerId,
    ).toBe('cus_1');
  });

  it('scopes invoice findByProviderId to the owning tenant', async () => {
    await storage.invoices.create({
      tenantId: 'acme',
      customerId: 'cus_1',
      subscriptionId: null,
      provider: 'stripe',
      providerInvoiceId: 'in_1',
      status: 'open',
      currency: 'USD',
      total: 1000,
      amountPaid: 0,
      amountDue: 1000,
      number: null,
      hostedInvoiceUrl: null,
      invoicePdf: null,
    });
    expect(await storage.invoices.findByProviderId('stripe', 'in_1', 'globex')).toBeNull();
    expect(
      (await storage.invoices.findByProviderId('stripe', 'in_1', 'acme'))?.providerInvoiceId,
    ).toBe('in_1');
  });

  it('scopes payment findByProviderId to the owning tenant', async () => {
    await storage.payments.create({
      tenantId: 'acme',
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_1',
      status: 'succeeded',
      currency: 'USD',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    expect(await storage.payments.findByProviderId('stripe', 'pi_1', 'globex')).toBeNull();
    expect(
      (await storage.payments.findByProviderId('stripe', 'pi_1', 'acme'))?.providerPaymentId,
    ).toBe('pi_1');
  });

  it('scopes product and price lookups to the owning tenant', async () => {
    const product = await storage.products.create({
      tenantId: 'acme',
      provider: 'stripe',
      providerProductId: 'prod_1',
      name: 'Plan',
      description: null,
      active: true,
      metadata: null,
    });
    await storage.prices.create({
      tenantId: 'acme',
      provider: 'stripe',
      providerPriceId: 'price_1',
      productId: product.id,
      currency: 'USD',
      unitAmount: 1000,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });

    expect(await storage.products.findByProviderId('stripe', 'prod_1', 'globex')).toBeNull();
    expect(
      (await storage.products.findByProviderId('stripe', 'prod_1', 'acme'))?.providerProductId,
    ).toBe('prod_1');
    expect(await storage.prices.findByProviderId('stripe', 'price_1', 'globex')).toBeNull();
    expect(await storage.prices.listByProduct(product.id, 'globex')).toHaveLength(0);
    expect(await storage.prices.listByProduct(product.id, 'acme')).toHaveLength(1);
  });
});

describe('subscription item tenant guard', () => {
  it('does not update or list items for a subscription owned by another tenant', async () => {
    const customer = await storage.customers.create({
      tenantId: 'acme',
      provider: 'stripe',
      providerCustomerId: 'cus_acme',
      billableType: 'User',
      billableId: '9',
      email: 'acme@example.com',
      name: null,
      metadata: null,
    });
    const subscription = await storage.subscriptions.create({
      tenantId: 'acme',
      customerId: customer.id,
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_acme',
      status: 'active',
      priceId: 'price_pro',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    await storage.subscriptionItems.create({
      subscriptionId: subscription.id,
      priceId: 'price_pro',
      providerItemId: null,
      quantity: 1,
    });

    expect(await storage.subscriptionItems.listBySubscription(subscription.id, 'globex')).toEqual(
      [],
    );
    await storage.subscriptionItems.updatePrimary(subscription.id, { quantity: 5 }, 'globex');
    const items = await storage.subscriptionItems.listBySubscription(subscription.id, 'acme');
    expect(items[0]?.quantity).toBe(1);
  });

  it('scopes a tenant item list in a single query', async () => {
    const subscription = await storage.subscriptions.create({
      tenantId: 'acme',
      customerId: 'cus_single',
      name: 'default',
      provider: 'stripe',
      providerSubscriptionId: 'sub_single',
      status: 'active',
      priceId: 'price_pro',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
    await storage.subscriptionItems.create({
      subscriptionId: subscription.id,
      priceId: 'price_pro',
      providerItemId: null,
      quantity: 1,
    });

    const statements: string[] = [];
    db.on('query', (query: { sql: string }) => statements.push(query.sql));
    await storage.subscriptionItems.listBySubscription(subscription.id, 'acme');
    expect(statements).toHaveLength(1);
  });
});
