import { expect, it } from 'vitest';
import type { StorageDriver } from '../../../src/domain/contracts/storage-driver.contract';
import type { ContractContext, StorageHarness } from './harness';

interface CatalogFixture {
  productId: string;
  priceId: string;
}

interface RuntimeProductRepository {
  findById(id: string): Promise<unknown>;
  update(id: string, patch: Record<string, unknown>): Promise<unknown>;
  findByProviderId(provider: string, providerProductId: string): Promise<unknown>;
}

interface RuntimePriceRepository {
  findById(id: string): Promise<unknown>;
  update(id: string, patch: Record<string, unknown>): Promise<unknown>;
  findByProviderId(provider: string, providerPriceId: string): Promise<unknown>;
  listByProduct(productId: string): Promise<unknown>;
}

const omittedTenantCalls: Array<{
  name: string;
  call(storage: StorageDriver, fixture: CatalogFixture): Promise<unknown>;
}> = [
  {
    name: 'product findById',
    call: (storage, fixture) =>
      (storage.products as unknown as RuntimeProductRepository).findById(fixture.productId),
  },
  {
    name: 'product update',
    call: (storage, fixture) =>
      (storage.products as unknown as RuntimeProductRepository).update(fixture.productId, {
        name: 'Unscoped mutation',
      }),
  },
  {
    name: 'product findByProviderId',
    call: (storage) =>
      (storage.products as unknown as RuntimeProductRepository).findByProviderId(
        'stripe',
        'prod_catalog_guard',
      ),
  },
  {
    name: 'price findById',
    call: (storage, fixture) =>
      (storage.prices as unknown as RuntimePriceRepository).findById(fixture.priceId),
  },
  {
    name: 'price update',
    call: (storage, fixture) =>
      (storage.prices as unknown as RuntimePriceRepository).update(fixture.priceId, {
        active: false,
      }),
  },
  {
    name: 'price findByProviderId',
    call: (storage) =>
      (storage.prices as unknown as RuntimePriceRepository).findByProviderId(
        'stripe',
        'price_catalog_guard',
      ),
  },
  {
    name: 'price listByProduct',
    call: (storage, fixture) =>
      (storage.prices as unknown as RuntimePriceRepository).listByProduct(fixture.productId),
  },
];

export function registerCatalogContract(ctx: ContractContext): void {
  it.each(
    omittedTenantCalls,
  )('rejects an omitted tenant in $name without changing catalog data', async ({ call }) => {
    const harness = ctx.harness();
    const fixture = await seedCatalog(harness.storage);

    await expect(call(harness.storage, fixture)).rejects.toThrow(/tenantId/i);
    await expectCatalogRowsUnchanged(harness, fixture);
  });

  it('cannot move a product through a JavaScript-shaped update patch', async () => {
    const harness = ctx.harness();
    const fixture = await seedCatalog(harness.storage);
    const patch = { name: 'Renamed product', tenantId: 'tenant-b' };

    const updated = await harness.storage.products.update(fixture.productId, patch, 'tenant-a');

    expect(updated).toMatchObject({ name: 'Renamed product', tenantId: 'tenant-a' });
    expect(await harness.readCatalogRow('product', fixture.productId)).toEqual({
      tenantId: 'tenant-a',
      tenantKey: 'tenant-a',
      name: 'Renamed product',
      active: true,
    });
  });

  it('allows only one product compare-and-set update from the same durable state', async () => {
    const harness = ctx.harness();
    const fixture = await seedCatalog(harness.storage);
    const expected = await harness.storage.products.findById(fixture.productId, 'tenant-a');
    expect(expected).not.toBeNull();
    if (!expected) {
      throw new Error('Seeded product is missing');
    }

    const repository = harness.storage.products as unknown as {
      updateIfUnchanged(
        id: string,
        before: typeof expected,
        patch: { name: string },
        tenantId: string,
      ): Promise<unknown | null>;
    };

    const updates = await Promise.all([
      repository.updateIfUnchanged(
        fixture.productId,
        expected,
        { name: 'Concurrent target' },
        'tenant-a',
      ),
      repository.updateIfUnchanged(
        fixture.productId,
        expected,
        { name: 'Concurrent target' },
        'tenant-a',
      ),
    ]);

    expect(updates.filter((product) => product !== null)).toHaveLength(1);
    expect(await harness.storage.products.findById(fixture.productId, 'tenant-a')).toMatchObject({
      name: 'Concurrent target',
    });
  });

  it('allows only one price compare-and-set update from the same durable state', async () => {
    const harness = ctx.harness();
    const fixture = await seedCatalog(harness.storage);
    const expected = await harness.storage.prices.findById(fixture.priceId, 'tenant-a');
    expect(expected).not.toBeNull();
    if (!expected) {
      throw new Error('Seeded price is missing');
    }
    const repository = harness.storage.prices as unknown as {
      updateIfUnchanged(
        id: string,
        before: typeof expected,
        patch: { unitAmount: number },
        tenantId: string,
      ): Promise<unknown | null>;
    };

    const updates = await Promise.all([
      repository.updateIfUnchanged(fixture.priceId, expected, { unitAmount: 2499 }, 'tenant-a'),
      repository.updateIfUnchanged(fixture.priceId, expected, { unitAmount: 2499 }, 'tenant-a'),
    ]);

    expect(updates.filter((price) => price !== null)).toHaveLength(1);
    expect(await harness.storage.prices.findById(fixture.priceId, 'tenant-a')).toMatchObject({
      unitAmount: 2499,
    });
  });

  it('cannot move a price through a JavaScript-shaped update patch', async () => {
    const harness = ctx.harness();
    const fixture = await seedCatalog(harness.storage);
    const patch = { active: false, tenantId: 'tenant-b' };

    const updated = await harness.storage.prices.update(fixture.priceId, patch, 'tenant-a');

    expect(updated).toMatchObject({ active: false, tenantId: 'tenant-a' });
    expect(await harness.readCatalogRow('price', fixture.priceId)).toEqual({
      tenantId: 'tenant-a',
      tenantKey: 'tenant-a',
      name: undefined,
      active: false,
    });
  });
}

async function seedCatalog(storage: StorageDriver): Promise<CatalogFixture> {
  const product = await storage.products.create({
    tenantId: 'tenant-a',
    provider: 'stripe',
    providerProductId: 'prod_catalog_guard',
    name: 'Original product',
    description: null,
    active: true,
    metadata: null,
  });
  const price = await storage.prices.create({
    tenantId: 'tenant-a',
    provider: 'stripe',
    providerPriceId: 'price_catalog_guard',
    productId: product.id,
    currency: 'usd',
    unitAmount: 1999,
    interval: 'month',
    intervalCount: 1,
    active: true,
  });

  return { productId: product.id, priceId: price.id };
}

async function expectCatalogRowsUnchanged(
  harness: StorageHarness,
  fixture: CatalogFixture,
): Promise<void> {
  expect(await harness.readCatalogRow('product', fixture.productId)).toEqual({
    tenantId: 'tenant-a',
    tenantKey: 'tenant-a',
    name: 'Original product',
    active: true,
  });
  expect(await harness.readCatalogRow('price', fixture.priceId)).toEqual({
    tenantId: 'tenant-a',
    tenantKey: 'tenant-a',
    name: undefined,
    active: true,
  });
}
