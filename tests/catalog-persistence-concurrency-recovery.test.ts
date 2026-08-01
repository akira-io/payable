import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { CatalogPersistenceError } from '../src/domain/errors/catalog-persistence.error';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { withPriceCasLoss, withProductCasLoss } from './support/catalog-cas-recovery-storage';
import { withMatchingProductCreateWinner } from './support/catalog-recovery-storage';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

describe('catalog concurrent persistence recovery', () => {
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

  it('accepts a matching winner after a create uniqueness failure', async () => {
    const recoveryReads = { count: 0 };
    const concurrentStorage = withMatchingProductCreateWinner(
      storage,
      {
        tenantId: 'tenant-a',
        provider: 'registered',
        providerProductId: 'prod_fake',
        name: 'Pro',
        description: null,
        active: true,
        metadata: null,
      },
      recoveryReads,
    );
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: concurrentStorage,
    }).products('registered', 'tenant-a');

    await expect(products.create({ name: 'Pro' })).resolves.toMatchObject({
      providerProductId: 'prod_fake',
    });

    expect(await db('payable_products')).toHaveLength(1);
    expect(recoveryReads.count).toBe(1);
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });

  it('does not duplicate transitions for repeated remote product identities', async () => {
    const provider = new FakeProvider();
    const products = createPayable({
      providers: { registered: provider },
      storage,
    }).products('registered', 'tenant-a');

    await products.create({ name: 'Pro' });
    await products.create({ name: 'Pro' });

    expect(await db('payable_products')).toHaveLength(1);
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toHaveLength(1);
    expect(await storage.outboxEvents.claimPending(10)).toHaveLength(1);
  });

  it('wraps a divergent compare-and-set loser without stale events', async () => {
    await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Durable winner',
      description: null,
      active: true,
      metadata: null,
    });
    const reads = { recovery: 0, transaction: 0 };
    const divergentStorage = withProductCasLoss(storage, reads);
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: divergentStorage,
    }).products('registered', 'tenant-a');

    const failure = products
      .update({ providerProductId: 'prod_fake', name: 'Divergent target' })
      .catch((error: unknown) => error);

    await expect(failure).resolves.toBeInstanceOf(CatalogPersistenceError);
    await expect(failure).resolves.toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      context: { providerResourceId: 'prod_fake', action: 'product.update' },
      cause: expect.objectContaining({ message: expect.stringContaining('changed') }),
    });
    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toMatchObject({ name: 'Durable winner' });
    expect(reads).toEqual({ recovery: 1, transaction: 1 });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });

  it('classifies a matching product winner only through the recovery read', async () => {
    const durable = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Converged target',
      description: null,
      active: true,
      metadata: null,
    });
    const reads = { recovery: 0, transaction: 0 };
    const concurrentStorage = withProductCasLoss(storage, reads, {
      ...durable,
      name: 'Stale state',
    });
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: concurrentStorage,
    }).products('registered', 'tenant-a');

    await expect(
      products.update({ providerProductId: 'prod_fake', name: 'Converged target' }),
    ).resolves.toMatchObject({ providerProductId: 'prod_fake' });

    expect(reads).toEqual({ recovery: 1, transaction: 1 });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });

  it('classifies a divergent price loser after one recovery read', async () => {
    const product = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    await storage.prices.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerPriceId: 'price_fake',
      productId: product.id,
      currency: 'USD',
      unitAmount: 1000,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });
    const reads = { recovery: 0, transaction: 0 };
    const prices = createPayable({
      providers: { registered: new FakeProvider() },
      storage: withPriceCasLoss(storage, reads),
    }).prices('registered', 'tenant-a');

    await expect(prices.archive('price_fake')).rejects.toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      context: { providerResourceId: 'price_fake', action: 'price.archive' },
      cause: expect.objectContaining({ message: expect.stringContaining('changed') }),
    });

    expect(reads).toEqual({ recovery: 1, transaction: 1 });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });
});
