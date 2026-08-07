import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

async function setupCanonicalCatalog() {
  const database = createTestDb();
  await migrate(database);
  const storage = new KnexStorageDriver(database, new FakeClock());
  return { database, payable: createPayable({ storage }) };
}

describe('canonical local price validation', () => {
  it('rejects a recurring price without an interval', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });

    await expect(
      payable.prices().create({
        productId: product.id,
        unitAmount: Money.of(2900, 'EUR'),
        type: 'recurring',
      }),
    ).rejects.toMatchObject({ code: 'PRICE_RECURRENCE_INVALID' });

    await database.destroy();
  });

  it('rejects recurring terms on a one-time price', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Setup' });

    await expect(
      payable.prices().create({
        productId: product.id,
        unitAmount: Money.of(4900, 'EUR'),
        type: 'one_time',
        interval: 'month',
      }),
    ).rejects.toMatchObject({ code: 'PRICE_RECURRENCE_INVALID' });

    await database.destroy();
  });

  it('rejects a non-positive recurring interval count', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });

    await expect(
      payable.prices().create({
        productId: product.id,
        unitAmount: Money.of(2900, 'EUR'),
        type: 'recurring',
        interval: 'month',
        intervalCount: 0,
      }),
    ).rejects.toMatchObject({ code: 'PRICE_RECURRENCE_INVALID' });

    await database.destroy();
  });

  it('rejects an invalid local lookup key before persistence', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });

    await expect(
      payable.prices().create({
        productId: product.id,
        unitAmount: Money.of(2900, 'EUR'),
        type: 'recurring',
        interval: 'month',
        lookupKey: '   ',
      }),
    ).rejects.toMatchObject({ code: 'PRICE_LOOKUP_KEY_INVALID' });

    await database.destroy();
  });

  it('keeps the current lookup-key owner when the transfer target is missing', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });
    const prices = payable.prices();
    const current = await prices.create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      lookupKey: 'pro_monthly',
    });

    await expect(prices.transferLookupKey('missing-price', 'pro_monthly')).rejects.toMatchObject({
      code: 'PRICE_NOT_FOUND',
    });
    await expect(prices.retrieve(current.id)).resolves.toMatchObject({
      lookupKey: 'pro_monthly',
    });

    await database.destroy();
  });

  it('rejects a price for a product in another tenant', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const product = await payable.products('tenant-a').create({ name: 'Pro' });

    await expect(
      payable.prices('tenant-b').create({
        productId: product.id,
        unitAmount: Money.of(2900, 'EUR'),
        type: 'recurring',
        interval: 'month',
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });

    await database.destroy();
  });
});
