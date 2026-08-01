import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { PriceRepository } from '../src/domain/contracts/price-repository.contract';
import type { ProductRepository } from '../src/domain/contracts/product-repository.contract';
import type { StorageDriver } from '../src/domain/contracts/storage-driver.contract';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

function legacyProductRepository(repository: ProductRepository): ProductRepository {
  return {
    create: (product) => repository.create(product),
    update: (id, patch, tenantId) => repository.update(id, patch, tenantId),
    findById: (id, tenantId) => repository.findById(id, tenantId),
    findByProviderId: (provider, providerProductId, tenantId) =>
      repository.findByProviderId(provider, providerProductId, tenantId),
  };
}

function legacyPriceRepository(repository: PriceRepository): PriceRepository {
  return {
    create: (price) => repository.create(price),
    update: (id, patch, tenantId) => repository.update(id, patch, tenantId),
    findById: (id, tenantId) => repository.findById(id, tenantId),
    findByProviderId: (provider, providerPriceId, tenantId) =>
      repository.findByProviderId(provider, providerPriceId, tenantId),
    listByProduct: (productId, tenantId) => repository.listByProduct(productId, tenantId),
  };
}

function legacyCatalogStorage(storage: StorageDriver): StorageDriver {
  const legacy = Object.create(storage) as StorageDriver;
  Object.defineProperties(legacy, {
    products: { value: legacyProductRepository(storage.products) },
    prices: { value: legacyPriceRepository(storage.prices) },
  });
  legacy.transaction = (work) =>
    storage.transaction((repositories) =>
      work({
        ...repositories,
        products: legacyProductRepository(repositories.products),
        prices: legacyPriceRepository(repositories.prices),
      }),
    );
  return legacy;
}

describe('legacy catalog repository compatibility', () => {
  let db: Knex;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('persists product and price updates without compare-and-set methods', async () => {
    const nativeStorage = new KnexStorageDriver(db, new FakeClock());
    const storage = legacyCatalogStorage(nativeStorage);
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const products = payable.products('stripe', 'tenant-a');
    const prices = payable.prices('stripe', 'tenant-a');
    await products.create({ name: 'Pro' });
    await prices.create({ providerProductId: 'prod_fake', unitAmount: Money.of(9900, 'USD') });

    await products.update({ providerProductId: 'prod_fake', name: 'Pro v2' });
    await prices.archive('price_fake');

    await expect(
      nativeStorage.products.findByProviderId('stripe', 'prod_fake', 'tenant-a'),
    ).resolves.toMatchObject({ name: 'Pro v2' });
    await expect(
      nativeStorage.prices.findByProviderId('stripe', 'price_fake', 'tenant-a'),
    ).resolves.toMatchObject({ active: false });
    expect(await nativeStorage.auditLogs.list({ tenantId: 'tenant-a' })).toHaveLength(4);
  });
});
