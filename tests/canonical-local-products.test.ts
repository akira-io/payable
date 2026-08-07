import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
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

describe('canonical local products', () => {
  it('creates and retrieves products without resolving a provider', async () => {
    const { database, payable } = await setupCanonicalCatalog();

    const product = await payable.products().create({
      name: 'Pro',
      description: 'Canonical product',
    });

    expect(product).toMatchObject({
      tenantId: null,
      name: 'Pro',
      description: 'Canonical product',
      active: true,
      metadata: null,
    });
    await expect(payable.products().retrieve(product.id)).resolves.toEqual(product);

    await database.destroy();
  });

  it('updates, archives, and reactivates products locally', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const products = payable.products();
    const product = await products.create({ name: 'Starter' });

    const updated = await products.update(product.id, {
      name: 'Growth',
      description: 'Updated locally',
    });
    const archived = await products.archive(product.id);
    const reactivated = await products.reactivate(product.id);

    expect(updated).toMatchObject({ name: 'Growth', description: 'Updated locally' });
    expect(archived.active).toBe(false);
    expect(reactivated.active).toBe(true);

    await database.destroy();
  });

  it('activates an archived product locally', async () => {
    const { database, payable } = await setupCanonicalCatalog();
    const products = payable.products();
    const product = await products.create({ name: 'Starter', active: false });

    await expect(products.activate(product.id)).resolves.toMatchObject({ active: true });

    await database.destroy();
  });

  it('lists products with deterministic tenant-scoped cursor pagination', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const tenantA = payable.products('tenant-a');
    const first = await tenantA.create({ name: 'Starter' });
    const second = await tenantA.create({ name: 'Pro' });
    await payable.products('tenant-b').create({ name: 'Other tenant' });

    const firstPage = await tenantA.list({ limit: 1 });
    const secondPage = await tenantA.list({ limit: 1, cursor: firstPage.nextCursor ?? undefined });

    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.nextCursor).toBeNull();
    expect([...firstPage.data, ...secondPage.data].map(({ id }) => id).sort()).toEqual(
      [first.id, second.id].sort(),
    );

    await database.destroy();
  });

  it('binds one product to multiple provider accounts', async () => {
    const { database, payable, storage } = await setupCanonicalCatalog();
    const product = await payable.products().create({ name: 'Pro' });

    await storage.productProviderBindings.create({
      tenantId: null,
      productId: product.id,
      provider: 'stripe-primary',
      providerProductId: 'prod_primary',
    });
    await storage.productProviderBindings.create({
      tenantId: null,
      productId: product.id,
      provider: 'stripe-secondary',
      providerProductId: 'prod_secondary',
    });

    await expect(
      storage.productProviderBindings.listByProductId(product.id, null),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: product.id,
          provider: 'stripe-primary',
          providerProductId: 'prod_primary',
        }),
        expect.objectContaining({
          productId: product.id,
          provider: 'stripe-secondary',
          providerProductId: 'prod_secondary',
        }),
      ]),
    );

    await database.destroy();
  });

  it('rejects provider bindings outside the canonical product tenant', async () => {
    const database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock());
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const product = await payable.products('tenant-a').create({ name: 'Pro' });

    await expect(
      storage.productProviderBindings.create({
        tenantId: 'tenant-b',
        productId: product.id,
        provider: 'stripe',
        providerProductId: 'prod_wrong_tenant',
      }),
    ).rejects.toBeDefined();

    await database.destroy();
  });
});
