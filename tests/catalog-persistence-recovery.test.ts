import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreateProductInput, ProductDTO } from '../src/domain/dtos/product.dto';
import { CatalogPersistenceError } from '../src/domain/errors/catalog-persistence.error';
import { ProductNotFoundError } from '../src/domain/errors/product-not-found.error';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import {
  withAuditFailure,
  withOutboxFailure,
  withProductCreateFailure,
  withProductRecoveryReadCount,
  withTransaction,
} from './support/catalog-recovery-storage';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class TrackingCatalogProvider extends FakeProvider {
  productCreateCalls = 0;
  productCreateContext?: OperationContext;

  override async createProduct(
    input: CreateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.productCreateCalls += 1;
    this.productCreateContext = context;
    return super.createProduct(input);
  }
}

describe('catalog persistence recovery', () => {
  let db: Knex;
  let storage: KnexStorageDriver;
  let provider: TrackingCatalogProvider;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
    storage = new KnexStorageDriver(db, new FakeClock());
    provider = new TrackingCatalogProvider();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('wraps an atomic transition failure after one recovery read', async () => {
    const persistenceCause = new Error('outbox unavailable');
    const recoveryReads = { count: 0 };
    const failingStorage = withProductRecoveryReadCount(
      withOutboxFailure(storage, persistenceCause),
      recoveryReads,
    );
    const products = createPayable({
      providers: { registered: provider },
      storage: failingStorage,
    }).providerCatalog('registered', 'tenant-a').products;

    const failure = products.create({ name: 'Pro' }).catch((error: unknown) => error);

    await expect(failure).resolves.toBeInstanceOf(CatalogPersistenceError);
    await expect(failure).resolves.toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      cause: persistenceCause,
      context: {
        resourceType: 'product',
        action: 'product.create',
        provider: 'registered',
        providerResourceId: 'prod_fake',
        tenantId: 'tenant-a',
        correlationId: provider.productCreateContext?.correlationId,
      },
    });
    expect(recoveryReads.count).toBe(1);
    expect(provider.productCreateCalls).toBe(1);
    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toBeNull();
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });

  it('accepts a committed transition when its acknowledgement is lost', async () => {
    const lostAcknowledgement = new Error('commit acknowledgement lost');
    const recoveryReads = { count: 0 };
    const lostAcknowledgementStorage = withProductRecoveryReadCount(
      withTransaction(storage, async (work) => {
        await storage.transaction(work);
        throw lostAcknowledgement;
      }),
      recoveryReads,
    );
    const products = createPayable({
      providers: { registered: provider },
      storage: lostAcknowledgementStorage,
    }).providerCatalog('registered', 'tenant-a').products;

    await expect(products.create({ name: 'Pro' })).resolves.toMatchObject({
      providerProductId: 'prod_fake',
    });

    expect(recoveryReads.count).toBe(1);
    expect(provider.productCreateCalls).toBe(1);
    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toMatchObject({ name: 'Pro' });
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toHaveLength(1);
    expect(await storage.outboxEvents.claimPending(10)).toHaveLength(1);
  });

  it.each([
    ['entity', withProductCreateFailure],
    ['audit', withAuditFailure],
  ] as const)('rolls back every local write when the %s write fails', async (_, failWrite) => {
    const persistenceCause = new Error('local write unavailable');
    const products = createPayable({
      providers: { registered: provider },
      storage: failWrite(storage, persistenceCause),
    }).providerCatalog('registered', 'tenant-a').products;

    await expect(products.create({ name: 'Pro' })).rejects.toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      cause: persistenceCause,
    });

    expect(provider.productCreateCalls).toBe(1);
    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toBeNull();
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });

  it('wraps a missing price parent after the provider lifecycle call', async () => {
    const prices = createPayable({
      providers: { registered: provider },
      storage,
    }).providerCatalog('registered', 'tenant-a').prices;

    const failure = prices.archive('price_fake').catch((error: unknown) => error);

    await expect(failure).resolves.toBeInstanceOf(CatalogPersistenceError);
    await expect(failure).resolves.toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      cause: expect.any(ProductNotFoundError),
      context: {
        resourceType: 'price',
        action: 'price.archive',
        provider: 'registered',
        providerResourceId: 'price_fake',
        tenantId: 'tenant-a',
        correlationId: provider.priceActiveCalls[0]?.ctx.correlationId,
      },
    });
    expect(provider.priceActiveCalls).toHaveLength(1);
    await expect(
      storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a'),
    ).resolves.toBeNull();
  });
});
