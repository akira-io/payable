import { expect, it } from 'vitest';
import type { StorageDriver } from '../../../src/domain/contracts/storage-driver.contract';
import type { ContractContext, StorageHarness } from './harness';

interface CatalogFixture {
  productId: string;
  priceId: string;
}

interface RuntimeProductRepository {
  create(data: Record<string, unknown>): Promise<unknown>;
  findById(id: string): Promise<unknown>;
  update(id: string, patch: Record<string, unknown>): Promise<unknown>;
  findByProviderId(provider: string, providerProductId: string): Promise<unknown>;
}

interface RuntimePriceRepository {
  create(data: Record<string, unknown>): Promise<unknown>;
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
  it('rejects a product create without a tenant before persisting it', async () => {
    const { storage } = ctx.harness();
    const products = storage.products as unknown as RuntimeProductRepository;

    await expect(
      products.create({
        provider: 'stripe',
        providerProductId: 'prod_omitted_tenant',
        name: 'Invalid product',
        description: null,
        active: true,
        metadata: null,
      }),
    ).rejects.toThrow(/tenantId/i);
    await expect(
      storage.products.findByProviderId('stripe', 'prod_omitted_tenant', null),
    ).resolves.toBeNull();
  });

  it('rejects a price create without a tenant before persisting it', async () => {
    const { storage } = ctx.harness();
    const product = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_price_parent',
      name: 'Price parent',
      description: null,
      active: true,
      metadata: null,
    });
    const prices = storage.prices as unknown as RuntimePriceRepository;

    await expect(
      prices.create({
        provider: 'stripe',
        providerPriceId: 'price_omitted_tenant',
        productId: product.id,
        currency: 'usd',
        unitAmount: 1999,
        interval: 'month',
        intervalCount: 1,
        active: true,
      }),
    ).rejects.toThrow(/tenantId/i);
    await expect(
      storage.prices.findByProviderId('stripe', 'price_omitted_tenant', null),
    ).resolves.toBeNull();
  });

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
