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
  return { database, payable: createPayable({ storage }), storage };
}

describe('canonical local prices', () => {
  it('creates a recurring price without resolving a provider', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });

    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      intervalCount: 1,
      lookupKey: 'pro_monthly',
    });

    expect(price).toMatchObject({
      tenantId: null,
      productId: product.id,
      currency: 'EUR',
      unitAmount: 2900,
      type: 'recurring',
      interval: 'month',
      intervalCount: 1,
      lookupKey: 'pro_monthly',
      active: true,
    });
    await expect(payable.prices().retrieve(price.id)).resolves.toEqual(price);

    await database.destroy();
  });

  it('archives and reactivates prices without changing their immutable terms', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });
    const prices = payable.prices();
    const price = await prices.create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      intervalCount: 1,
      lookupKey: 'pro_monthly',
    });

    const archived = await prices.archive(price.id);
    const reactivated = await prices.reactivate(price.id);

    expect(archived).toMatchObject({ ...price, active: false });
    expect(reactivated).toMatchObject({ ...price, active: true });

    await database.destroy();
  });

  it('activates an archived price locally', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });
    const prices = payable.prices();
    const price = await prices.create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      active: false,
    });

    await expect(prices.activate(price.id)).resolves.toMatchObject({ active: true });

    await database.destroy();
  });

  it('updates mutable price details without changing immutable billing terms', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });
    const prices = payable.prices();
    const price = await prices.create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      description: 'Original',
    });

    const updated = await prices.update(price.id, {
      description: 'Updated',
      unitAmount: Money.of(9900, 'EUR'),
    } as never);

    expect(updated).toMatchObject({
      description: 'Updated',
      unitAmount: 2900,
      currency: 'EUR',
      type: 'recurring',
      interval: 'month',
    });

    await database.destroy();
  });

  it('transfers a lookup key atomically between canonical prices', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });
    const prices = payable.prices();
    const previous = await prices.create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      lookupKey: 'pro_monthly',
    });
    const replacement = await prices.create({
      productId: product.id,
      unitAmount: Money.of(3900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });

    const transferred = await prices.transferLookupKey(replacement.id, 'pro_monthly');

    expect(transferred).toMatchObject({ id: replacement.id, lookupKey: 'pro_monthly' });
    await expect(prices.retrieve(previous.id)).resolves.toMatchObject({ lookupKey: null });

    await database.destroy();
  });

  it('allows only one concurrent canonical price to claim a tenant lookup key', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });
    const prices = payable.prices();
    const input = {
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring' as const,
      interval: 'month' as const,
      lookupKey: 'pro_concurrent',
    };

    const results = await Promise.allSettled([prices.create(input), prices.create(input)]);
    const owners = await prices.list({ lookupKeys: ['pro_concurrent'] });

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(owners.items).toHaveLength(1);

    await database.destroy();
  });

  it('lists prices with tenant-scoped cursor pagination and canonical filters', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const products = payable.products('tenant-a');
    const prices = payable.prices('tenant-a');
    const product = await products.create({ name: 'Pro' });
    const otherProduct = await products.create({ name: 'Addon' });
    const monthly = await prices.create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const annual = await prices.create({
      productId: product.id,
      unitAmount: Money.of(29000, 'EUR'),
      type: 'recurring',
      interval: 'year',
    });
    await prices.create({
      productId: otherProduct.id,
      unitAmount: Money.of(900, 'EUR'),
      type: 'one_time',
    });
    const tenantBProduct = await payable.products('tenant-b').create({ name: 'Other tenant' });
    await payable.prices('tenant-b').create({
      productId: tenantBProduct.id,
      unitAmount: Money.of(100, 'EUR'),
      type: 'one_time',
    });

    const firstPage = await prices.list({ limit: 1, productId: product.id, active: true });
    const secondPage = await prices.list({
      limit: 1,
      productId: product.id,
      active: true,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.nextCursor).toBeNull();
    expect([...firstPage.items, ...secondPage.items].map(({ id }) => id).sort()).toEqual(
      [monthly.id, annual.id].sort(),
    );

    await database.destroy();
  });

  it('binds one price to multiple provider accounts', async () => {
    const { database, payable, storage } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });

    await storage.priceProviderBindings.create({
      tenantId: null,
      priceId: price.id,
      provider: 'stripe-primary',
      providerPriceId: 'price_primary',
    });
    await storage.priceProviderBindings.create({
      tenantId: null,
      priceId: price.id,
      provider: 'stripe-secondary',
      providerPriceId: 'price_secondary',
    });

    await expect(storage.priceProviderBindings.listByPriceId(price.id, null)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'stripe-primary', providerPriceId: 'price_primary' }),
        expect.objectContaining({
          provider: 'stripe-secondary',
          providerPriceId: 'price_secondary',
        }),
      ]),
    );

    await database.destroy();
  });
});
