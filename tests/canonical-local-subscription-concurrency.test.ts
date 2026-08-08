import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isUniqueConstraintViolation } from '../src/application/services/storage/is-unique-constraint-violation';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';

describe('canonical subscription write races', () => {
  it('recognizes Prisma unique violations as retryable conflicts', () => {
    expect(isUniqueConstraintViolation({ code: 'P2002' })).toBe(true);
  });

  it('revalidates the active recurring price inside the write transaction', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'archived-during-create',
      email: 'archive-race@example.com',
    });
    const product = await payable.products().create({ name: 'Race Product' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(1900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const originalTransaction = storage.transaction.bind(storage);
    vi.spyOn(storage, 'transaction').mockImplementationOnce(async (work) => {
      await storage.canonicalPrices?.update(price.id, { active: false }, null);
      return originalTransaction(work);
    });

    await expect(
      payable.canonicalSubscriptions().create({
        customerId: customer.id,
        name: 'default',
        priceId: price.id,
        activation: { state: 'pending' },
        collectionResponsibility: 'merchant',
        source: 'api',
      }),
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_PRICE_UNAVAILABLE' });
    await expect(storage.subscriptions.list()).resolves.toHaveLength(0);
    await database.destroy();
  });

  it('returns an exact existing subscription after its accepted price is archived', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage });
    const customer = await payable.customers().create({
      billableType: 'Team',
      billableId: 'archived-price-retry',
      email: 'archived-retry@example.com',
    });
    const product = await payable.products().create({ name: 'Archived Retry Product' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2300, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const input = {
      customerId: customer.id,
      name: 'default',
      priceId: price.id,
      activation: { state: 'pending' as const },
      collectionResponsibility: 'merchant' as const,
      source: 'api',
    };

    const created = await payable.canonicalSubscriptions().create(input);
    await payable.prices().archive(price.id);
    const retry = await payable.canonicalSubscriptions().create(input);

    expect(retry.id).toBe(created.id);
    await database.destroy();
  });
});

describe('Prisma canonical subscription retries', () => {
  let prisma: PrismaClientLike;

  beforeAll(async () => {
    prisma = await createPrismaTestClient();
  }, 120_000);

  afterAll(async () => {
    await disconnectPrisma(prisma);
  });

  it('converges concurrent creation and provider attachment', async () => {
    const storage = new PrismaStorageDriver(prisma, new FakeClock());
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const tenantId = 'prisma-concurrent-subscription';
    const customer = await payable.customers(undefined, tenantId).create({
      billableType: 'Team',
      billableId: 'prisma-concurrent-team',
      email: 'prisma-concurrent@example.com',
    });
    const product = await payable.products(tenantId).create({ name: 'Concurrent Product' });
    const price = await payable.prices(tenantId).create({
      productId: product.id,
      unitAmount: Money.of(3100, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const input = {
      customerId: customer.id,
      name: 'default',
      priceId: price.id,
      activation: { state: 'pending' as const },
      collectionResponsibility: 'merchant' as const,
      source: 'api',
    };

    const subscriptions = await Promise.all([
      payable.canonicalSubscriptions(tenantId).create(input),
      payable.canonicalSubscriptions(tenantId).create(input),
    ]);
    expect(subscriptions[0]?.id).toBe(subscriptions[1]?.id);
    const subscriptionId = subscriptions[0]?.id as string;
    const attach = () =>
      payable.canonicalSubscriptions(tenantId).attachProvider(subscriptionId, {
        provider: 'stripe-primary',
        providerSubscriptionId: 'sub_prisma_concurrent',
      });
    const bindings = await Promise.all([attach(), attach()]);
    expect(bindings[0]?.id).toBe(bindings[1]?.id);
  });
});
