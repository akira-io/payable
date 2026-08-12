import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const TENANT = 'tenant-product-relations';
const BASE_TIME = new Date('2026-08-10T10:00:00.000Z');

describe('canonical subscription product relations', () => {
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

  it('filters by immutable product identity with cursor isolation', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, TENANT).create({
      billableType: 'User',
      billableId: 'product-filter',
      email: 'product-filter@example.com',
    });
    const product = await payable.products(TENANT).create({ name: 'Filtered product' });
    const otherProduct = await payable.products(TENANT).create({ name: 'Other product' });
    const monthly = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: Money.of(1900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const yearly = await payable.prices(TENANT).create({
      productId: product.id,
      unitAmount: Money.of(19_000, 'EUR'),
      type: 'recurring',
      interval: 'year',
    });
    const otherPrice = await payable.prices(TENANT).create({
      productId: otherProduct.id,
      unitAmount: Money.of(900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    for (const [name, priceId] of [
      ['monthly', monthly.id],
      ['yearly', yearly.id],
      ['other', otherPrice.id],
    ] as const) {
      await payable.canonicalSubscriptions(TENANT).create({
        customerId: customer.id,
        name,
        priceId,
        activation: { state: 'pending' },
        collectionResponsibility: 'merchant',
        source: 'test',
      });
      clock.advance(1_000);
    }

    const first = await payable
      .canonicalSubscriptions(TENANT)
      .list({ canonicalProductId: product.id, limit: 1 });
    const second = await payable.canonicalSubscriptions(TENANT).list({
      canonicalProductId: product.id,
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.items[0]).toMatchObject({ canonicalProductId: product.id });
    expect(second.items[0]).toMatchObject({ canonicalProductId: product.id });
    expect(first.hasMore).toBe(true);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    await expect(
      payable.canonicalSubscriptions(TENANT).list({
        canonicalProductId: otherProduct.id,
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toMatchObject({ code: 'COLLECTION_CURSOR_INVALID' });
  });
});
