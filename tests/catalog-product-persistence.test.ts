import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreateProductInput, ProductDTO } from '../src/domain/dtos/product.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class TrackingCatalogProvider extends FakeProvider {
  createProductContext?: OperationContext;
  createProductError?: Error;

  override async createProduct(
    input: CreateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.createProductContext = context;
    if (this.createProductError) {
      throw this.createProductError;
    }
    return super.createProduct(input);
  }
}

describe('product mutation persistence', () => {
  let db: Knex;
  let storage: KnexStorageDriver;
  let provider: TrackingCatalogProvider;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
    provider = new TrackingCatalogProvider();
    storage = new KnexStorageDriver(db, new FakeClock(new Date('2026-08-01T00:00:00.000Z')));
  });

  afterEach(async () => {
    await db.destroy();
  });

  function payableWithStorage() {
    return createPayable({
      providers: { registered: provider },
      storage,
      clock: new FakeClock(new Date('2026-08-01T00:00:00.000Z')),
    });
  }

  async function outboxRows(): Promise<Record<string, unknown>[]> {
    return db('payable_outbox_events').orderBy('created_at');
  }

  it('persists a created product with one audit and outbox transition', async () => {
    const payable = payableWithStorage();

    const product = await payable.providerCatalog('registered', 'tenant-a').products.create(
      {
        name: 'Pro',
        description: 'Monthly product',
        metadata: { tier: 'pro' },
      },
      {
        authorization: { allowed: true, actorType: 'service', actorId: 'catalog-admin' },
      },
    );

    const localProduct = await storage.products.findByProviderId(
      'registered',
      product.providerProductId,
      'tenant-a',
    );
    expect(localProduct).toMatchObject({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: product.providerProductId,
      name: 'Pro',
      description: 'Monthly product',
      active: true,
      metadata: { tier: 'pro' },
    });
    const auditLogs = await storage.auditLogs.list({ resourceType: 'product' });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      tenantId: 'tenant-a',
      action: 'product.created',
      correlationId: provider.createProductContext?.correlationId,
      actorType: 'service',
      actorId: 'catalog-admin',
      resourceType: 'product',
      resourceId: localProduct?.id,
      before: null,
      after: {
        id: localProduct?.id,
        tenantId: 'tenant-a',
        provider: 'registered',
        providerProductId: product.providerProductId,
        name: 'Pro',
        description: 'Monthly product',
        active: true,
        metadata: { tier: 'pro' },
      },
      metadata: {
        provider: 'registered',
        providerResourceId: product.providerProductId,
      },
      ipAddress: null,
      userAgent: null,
    });
    const outbox = await outboxRows();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      tenant_id: 'tenant-a',
      correlation_id: provider.createProductContext?.correlationId,
      event_type: 'product.created.v1',
      event_version: 1,
      dedupe_key: `catalog:product:product.create:registered:${product.providerProductId}:${provider.createProductContext?.correlationId}`,
    });
    expect(JSON.parse(outbox[0]?.payload as string)).toEqual({
      action: 'product.create',
      resourceType: 'product',
      resourceId: localProduct?.id,
      provider: 'registered',
      providerResourceId: product.providerProductId,
      tenantId: 'tenant-a',
      state: auditLogs[0]?.after,
    });
  });

  it('updates the existing local product and records an update transition', async () => {
    const payable = payableWithStorage();
    const created = await payable
      .providerCatalog('registered', 'tenant-a')
      .products.create({ name: 'Pro' });
    const localBefore = await storage.products.findByProviderId(
      'registered',
      created.providerProductId,
      'tenant-a',
    );

    await payable.providerCatalog('registered', 'tenant-a').products.update(
      {
        providerProductId: created.providerProductId,
        name: 'Pro v2',
        description: 'Updated product',
      },
      { authorization: { allowed: true, actorType: 'user', actorId: 'editor-1' } },
    );

    const localAfter = await storage.products.findByProviderId(
      'registered',
      created.providerProductId,
      'tenant-a',
    );
    expect(localAfter).toMatchObject({
      id: localBefore?.id,
      name: 'Pro v2',
      description: 'Updated product',
    });
    const updateAudit = (await storage.auditLogs.list({ resourceType: 'product' }))[0];
    expect(updateAudit).toMatchObject({
      tenantId: 'tenant-a',
      action: 'product.updated',
      actorType: 'user',
      actorId: 'editor-1',
      resourceType: 'product',
      resourceId: localBefore?.id,
      before: {
        id: localBefore?.id,
        tenantId: 'tenant-a',
        provider: 'registered',
        providerProductId: created.providerProductId,
        name: 'Pro',
        description: null,
        active: true,
        metadata: null,
      },
      after: {
        id: localBefore?.id,
        tenantId: 'tenant-a',
        provider: 'registered',
        providerProductId: created.providerProductId,
        name: 'Pro v2',
        description: 'Updated product',
        active: true,
        metadata: null,
      },
      metadata: {
        provider: 'registered',
        providerResourceId: created.providerProductId,
      },
      ipAddress: null,
      userAgent: null,
    });
    const updateOutbox = await outboxRows();
    expect(updateOutbox.map((row) => row.event_type)).toEqual([
      'product.created.v1',
      'product.updated.v1',
    ]);
    expect(updateOutbox[1]).toMatchObject({
      tenant_id: 'tenant-a',
      correlation_id: updateAudit?.correlationId,
      event_type: 'product.updated.v1',
      event_version: 1,
      dedupe_key: `catalog:product:product.update:registered:${created.providerProductId}:${updateAudit?.correlationId}`,
    });
    expect(JSON.parse(updateOutbox[1]?.payload as string)).toEqual({
      action: 'product.update',
      resourceType: 'product',
      resourceId: localBefore?.id,
      provider: 'registered',
      providerResourceId: created.providerProductId,
      tenantId: 'tenant-a',
      state: updateAudit?.after,
    });
  });

  it('persists archive and activate states with their matching transitions', async () => {
    const payable = payableWithStorage();
    await payable.providerCatalog('registered', 'tenant-a').products.create({ name: 'Pro' });

    await payable.providerCatalog('registered', 'tenant-a').products.archive('prod_fake');
    expect(
      await storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).toMatchObject({ active: false });
    await payable.providerCatalog('registered', 'tenant-a').products.activate('prod_fake');
    expect(
      await storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).toMatchObject({ active: true });

    expect((await outboxRows()).map((row) => row.event_type)).toEqual([
      'product.created.v1',
      'product.archived.v1',
      'product.activated.v1',
    ]);
  });

  it('does not duplicate transitions for an identical provider state', async () => {
    const payable = payableWithStorage();
    const products = payable.providerCatalog('registered', 'tenant-a').products;

    await products.create({ name: 'Pro', metadata: { tier: 'pro' } });
    await products.create({ name: 'Pro', metadata: { tier: 'pro' } });

    expect(await storage.auditLogs.list({ resourceType: 'product' })).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(1);
  });

  it('leaves durable catalog state untouched when the provider fails', async () => {
    provider.createProductError = new Error('provider unavailable');
    const payable = payableWithStorage();

    await expect(
      payable.providerCatalog('registered', 'tenant-a').products.create({ name: 'Pro' }),
    ).rejects.toThrow('provider unavailable');

    for (const table of [
      'payable_products',
      'payable_prices',
      'payable_audit_logs',
      'payable_outbox_events',
    ]) {
      expect(await db(table)).toEqual([]);
    }
  });

  it('keeps all product mutations provider-only without storage', async () => {
    const payable = createPayable({ providers: { registered: provider } });
    const products = payable.providerCatalog('registered', 'tenant-a').products;

    const created = await products.create({ name: 'Pro' });
    const updated = await products.update({
      providerProductId: created.providerProductId,
      name: 'Pro v2',
    });
    const archived = await products.archive(created.providerProductId);
    const activated = await products.activate(created.providerProductId);

    expect([created.name, updated.name, archived.active, activated.active]).toEqual([
      'Pro',
      'Pro v2',
      false,
      true,
    ]);
    expect(provider.productActiveCalls).toHaveLength(2);
  });
});
