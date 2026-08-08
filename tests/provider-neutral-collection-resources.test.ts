import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const TENANT = 'tenant-pages';
const BASE_TIME = new Date('2026-08-08T10:00:00.000Z');

describe('provider-neutral collection resources', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];
  let clock: FakeClock;
  let storage: KnexStorageDriver;

  beforeEach(async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    clock = new FakeClock(BASE_TIME);
    storage = new KnexStorageDriver(database, clock);
  });

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('returns the same page shape for all storage-only billing collections', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'ada',
      email: 'ada@example.com',
    });
    const product = await payable.products(TENANT).create({ name: 'Pro' });
    const price = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const subscription = await payable.canonicalSubscriptions(TENANT).create({
      customerId: customer.id,
      name: 'default',
      priceId: price.id,
      activation: { state: 'active', startsAt: BASE_TIME },
      collectionResponsibility: 'merchant',
      source: 'test',
    });
    const payment = await storage.payments.create({
      tenantId: TENANT,
      customerId: customer.id,
      provider: 'manual',
      providerPaymentId: null,
      status: 'pending',
      currency: 'EUR',
      amount: 2900,
      refundedAmount: 0,
      reference: 'bank-transfer-100',
      description: 'Manual collection',
    });

    await expect(payable.customers(undefined, TENANT).list()).resolves.toEqual({
      items: [customer],
      nextCursor: null,
      hasMore: false,
    });
    await expect(payable.products(TENANT).list()).resolves.toEqual({
      items: [product],
      nextCursor: null,
      hasMore: false,
    });
    await expect(payable.prices(TENANT).list()).resolves.toEqual({
      items: [price],
      nextCursor: null,
      hasMore: false,
    });
    await expect(payable.canonicalSubscriptions(TENANT).list()).resolves.toEqual({
      items: [subscription],
      nextCursor: null,
      hasMore: false,
    });
    await expect(payable.storedPayments(TENANT).list()).resolves.toEqual({
      items: [payment],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('rejects a continuation cursor after filters change', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    await payable.products(TENANT).create({ name: 'Starter', active: true });
    clock.advance(1_000);
    await payable.products(TENANT).create({ name: 'Growth', active: true });
    const first = await payable.products(TENANT).list({ limit: 1, active: true });

    await expect(
      payable.products(TENANT).list({
        limit: 1,
        active: false,
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: 'COLLECTION_CURSOR_INVALID' });
  });

  it('keeps subscription and payment array APIs as compatibility paths', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });

    await expect(payable.subscriptions(TENANT)).resolves.toEqual([]);
    await expect(payable.payments(TENANT)).resolves.toEqual([]);
  });

  it('paginates equal-timestamp subscriptions and payments without crossing tenants', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customerIds: string[] = [];
    for (const suffix of ['one', 'two', 'three']) {
      const customer = await payable.customers(undefined, TENANT).create({
        billableType: 'User',
        billableId: suffix,
        email: `${suffix}@example.com`,
      });
      customerIds.push(customer.id);
      await storage.subscriptions.create({
        tenantId: TENANT,
        customerId: customer.id,
        name: suffix,
        provider: null,
        providerSubscriptionId: null,
        status: 'active',
        priceId: null,
        quantity: 1,
        collectionResponsibility: 'merchant',
        trialEndsAt: null,
        endsAt: null,
        currentPeriodStart: BASE_TIME,
        currentPeriodEnd: new Date('2026-09-08T10:00:00.000Z'),
      });
      await storage.payments.create({
        tenantId: TENANT,
        customerId: customer.id,
        provider: 'manual',
        providerPaymentId: null,
        status: 'pending',
        currency: 'EUR',
        amount: 1000,
        refundedAmount: 0,
        reference: `transfer-${suffix}`,
        description: 'Manual payment',
      });
    }
    await storage.payments.create({
      tenantId: 'tenant-other',
      customerId: null,
      provider: 'manual',
      providerPaymentId: null,
      status: 'pending',
      currency: 'EUR',
      amount: 1000,
      refundedAmount: 0,
      reference: 'transfer-other',
      description: 'Other tenant',
    });

    const firstSubscriptions = await payable.canonicalSubscriptions(TENANT).list({ limit: 2 });
    const secondSubscriptions = await payable.canonicalSubscriptions(TENANT).list({
      limit: 2,
      cursor: firstSubscriptions.nextCursor ?? undefined,
    });
    const firstPayments = await payable.storedPayments(TENANT).list({ limit: 2 });
    const secondPayments = await payable.storedPayments(TENANT).list({
      limit: 2,
      cursor: firstPayments.nextCursor ?? undefined,
    });

    expect([...firstSubscriptions.items, ...secondSubscriptions.items]).toHaveLength(3);
    expect(firstSubscriptions.hasMore).toBe(true);
    expect(secondSubscriptions).toMatchObject({ hasMore: false, nextCursor: null });
    expect([...firstPayments.items, ...secondPayments.items]).toHaveLength(3);
    expect(firstPayments.hasMore).toBe(true);
    expect(secondPayments).toMatchObject({ hasMore: false, nextCursor: null });
    expect((await payable.storedPayments(TENANT).list({ reference: 'TWO' })).items).toHaveLength(1);
    expect(
      (await payable.canonicalSubscriptions(TENANT).list({ customerId: customerIds[0] })).items,
    ).toHaveLength(1);
  });

  it('adds safe provider binding metadata only when requested', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'bound',
      email: 'bound@example.com',
    });
    const product = await payable.products(TENANT).create({ name: 'Bound product' });
    const price = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: Money.of(4900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const subscription = await payable.canonicalSubscriptions(TENANT).create({
      customerId: customer.id,
      name: 'bound',
      priceId: price.id,
      activation: { state: 'pending' },
      collectionResponsibility: 'merchant',
      source: 'test',
    });
    const productBinding = await storage.productProviderBindings.create({
      tenantId: TENANT,
      productId: product.id,
      provider: 'stripe',
      providerProductId: 'prod_safe',
    });
    const priceBinding = await storage.priceProviderBindings.create({
      tenantId: TENANT,
      priceId: price.id,
      provider: 'stripe',
      providerPriceId: 'price_safe',
    });
    const subscriptionBinding = await storage.subscriptionProviderBindings.create({
      tenantId: TENANT,
      subscriptionId: subscription.id,
      provider: 'stripe',
      providerSubscriptionId: 'sub_safe',
      providerSyncedAt: null,
    });

    expect((await payable.products(TENANT).list()).items[0]).not.toHaveProperty('bindings');
    expect((await payable.prices(TENANT).list()).items[0]).not.toHaveProperty('bindings');
    expect((await payable.canonicalSubscriptions(TENANT).list()).items[0]).not.toHaveProperty(
      'bindings',
    );
    expect((await payable.products(TENANT).list({ includeBindings: true })).items[0]).toMatchObject(
      {
        bindings: [
          {
            id: productBinding.id,
            provider: 'stripe',
            providerProductId: 'prod_safe',
          },
        ],
      },
    );
    expect((await payable.prices(TENANT).list({ includeBindings: true })).items[0]).toMatchObject({
      bindings: [{ id: priceBinding.id, provider: 'stripe', providerPriceId: 'price_safe' }],
    });
    expect(
      (await payable.canonicalSubscriptions(TENANT).list({ includeBindings: true })).items[0],
    ).toMatchObject({
      bindings: [
        {
          id: subscriptionBinding.id,
          provider: 'stripe',
          providerSubscriptionId: 'sub_safe',
          providerSyncedAt: null,
        },
      ],
    });
  });
});
