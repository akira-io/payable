import { afterEach, describe, expect, it } from 'vitest';
import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../src/domain/contracts/queue-driver.contract';
import { Money } from '../src/domain/value-objects/money';
import {
  closeCatalogSyncDatabases,
  SynchronizingProvider,
  setupCatalogSync,
  setupCatalogSyncProviders,
} from './support/catalog-sync-fixture';
import { FakeProvider } from './support/fake-provider';

afterEach(closeCatalogSyncDatabases);

class DeferredQueue implements QueueDriver {
  readonly inline = false;
  readonly jobs: QueueJob[] = [];
  readonly handlers = new Map<string, JobHandler>();

  async dispatch<T>(job: QueueJob<T>): Promise<void> {
    this.jobs.push(job);
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler);
  }
}

describe('catalog synchronization', () => {
  it('keeps canonical CRUD local and explicitly creates a provider binding', async () => {
    const { payable, provider, storage } = await setupCatalogSync();
    const product = await payable.products().create({ name: 'Pro', description: 'Canonical' });

    expect(provider.productCreates).toBe(0);
    const synchronization = await payable.catalogSync('stripe-primary').requestProduct(product.id);

    expect(synchronization).toMatchObject({
      tenantId: null,
      provider: 'stripe-primary',
      resourceType: 'product',
      resourceId: product.id,
      operation: 'create',
      status: 'succeeded',
      reconciliationState: 'in_sync',
      retryCount: 0,
      lastErrorCode: null,
      providerResourceId: 'prod_1',
    });
    expect(synchronization.lastAttemptedAt).toEqual(new Date('2026-08-08T10:00:00.000Z'));
    expect(synchronization.lastSucceededAt).toEqual(new Date('2026-08-08T10:00:00.000Z'));
    expect(provider.lastProductContext?.idempotencyKey).toMatch(
      /^payable:catalog-sync:v1:[a-f0-9]{64}$/,
    );
    await expect(
      storage.productProviderBindings.findByProductAndProvider(product.id, 'stripe-primary', null),
    ).resolves.toMatchObject({ providerProductId: 'prod_1' });
    const audit = await storage.auditLogs.list({ resourceId: product.id });
    expect(audit.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'catalog.synchronization.requested',
        'catalog.synchronization.succeeded',
      ]),
    );
    expect(audit).toHaveLength(2);
  });

  it('persists requested state before dispatching asynchronous work', async () => {
    const queue = new DeferredQueue();
    const { payable, provider } = await setupCatalogSync(new SynchronizingProvider(), queue);
    const product = await payable.products().create({ name: 'Queued' });

    await expect(
      payable.catalogSync('stripe-primary').requestProduct(product.id),
    ).resolves.toMatchObject({
      status: 'requested',
      providerResourceId: null,
    });
    expect(provider.productCreates).toBe(0);
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        name: 'catalog.synchronize',
        payload: expect.objectContaining({ resourceType: 'product', resourceId: product.id }),
      }),
    ]);
  });

  it('persists unsupported results without changing canonical state', async () => {
    const { payable, storage } = await setupCatalogSync(new FakeProvider());
    const product = await payable.products().create({ name: 'Amount-only provider product' });
    const synchronization = await payable.catalogSync('stripe-primary').requestProduct(product.id);

    expect(synchronization).toMatchObject({
      status: 'skipped',
      reconciliationState: 'unsupported',
      lastErrorCode: 'CATALOG_SYNC_OPERATION_UNSUPPORTED',
      providerResourceId: null,
    });
    await expect(payable.products().retrieve(product.id)).resolves.toMatchObject({ active: true });
    await expect(
      storage.productProviderBindings.findByProductAndProvider(product.id, 'stripe-primary', null),
    ).resolves.toBeNull();
  });

  it('does not infer an unsupported update from create support', async () => {
    const provider = new SynchronizingProvider();
    provider.supportedCapabilities.delete('catalogProductUpdate');
    const { clock, payable } = await setupCatalogSync(provider);
    const product = await payable.products().create({ name: 'Create only' });
    const synchronization = payable.catalogSync('stripe-primary');
    await synchronization.requestProduct(product.id);

    clock.advance(1_000);
    await payable.products().update(product.id, { name: 'Still local' });
    await expect(synchronization.requestProduct(product.id)).resolves.toMatchObject({
      operation: 'update',
      status: 'skipped',
      reconciliationState: 'unsupported',
    });
    expect(provider.lastUpdateProduct).toBeUndefined();
    await expect(payable.products().retrieve(product.id)).resolves.toMatchObject({
      name: 'Still local',
    });
  });

  it('synchronizes a product before its dependent provider price', async () => {
    const { payable, provider, storage } = await setupCatalogSync();
    const product = await payable.products().create({ name: 'Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const synchronization = await payable.catalogSync('stripe-primary').requestPrice(price.id);

    expect(provider.synchronizationOrder).toEqual(['product', 'price']);
    expect(synchronization).toMatchObject({
      resourceType: 'price',
      status: 'succeeded',
      providerResourceId: 'price_1',
    });
    await expect(
      storage.priceProviderBindings.findByPriceAndProvider(price.id, 'stripe-primary', null),
    ).resolves.toMatchObject({ providerPriceId: 'price_1' });
  });

  it('resolves product lifecycle capabilities independently', async () => {
    const { clock, payable, provider } = await setupCatalogSync();
    const product = await payable.products().create({ name: 'Pro' });
    const synchronization = payable.catalogSync('stripe-primary');
    await synchronization.requestProduct(product.id);

    clock.advance(1_000);
    await payable.products().update(product.id, { name: 'Pro Plus' });
    await expect(synchronization.requestProduct(product.id)).resolves.toMatchObject({
      operation: 'update',
      status: 'succeeded',
    });
    expect(provider.lastUpdateProduct).toMatchObject({ name: 'Pro Plus' });
    clock.advance(1_000);
    await payable.products().archive(product.id);
    await expect(synchronization.requestProduct(product.id)).resolves.toMatchObject({
      operation: 'archive',
      status: 'succeeded',
    });
    clock.advance(1_000);
    await payable.products().reactivate(product.id);
    await expect(synchronization.requestProduct(product.id)).resolves.toMatchObject({
      operation: 'reactivate',
      status: 'succeeded',
    });
    expect(provider.productActiveCalls).toEqual([
      expect.objectContaining({ active: false }),
      expect.objectContaining({ active: true }),
    ]);
  });

  it('resolves price lifecycle capabilities independently', async () => {
    const { clock, payable, provider } = await setupCatalogSync();
    const product = await payable.products().create({ name: 'Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      description: 'Monthly',
    });
    const synchronization = payable.catalogSync('stripe-primary');
    await synchronization.requestPrice(price.id);

    clock.advance(1_000);
    await payable.prices().update(price.id, { description: 'Monthly access' });
    await expect(synchronization.requestPrice(price.id)).resolves.toMatchObject({
      operation: 'update',
      status: 'succeeded',
    });
    clock.advance(1_000);
    await payable.prices().archive(price.id);
    await expect(synchronization.requestPrice(price.id)).resolves.toMatchObject({
      operation: 'archive',
      status: 'succeeded',
    });
    clock.advance(1_000);
    await payable.prices().reactivate(price.id);
    await expect(synchronization.requestPrice(price.id)).resolves.toMatchObject({
      operation: 'reactivate',
      status: 'succeeded',
    });
    expect(provider.priceUpdates.at(-1)?.description).toBe('Monthly access');
    expect(provider.priceActiveCalls).toEqual([
      expect.objectContaining({ active: false }),
      expect.objectContaining({ active: true }),
    ]);
  });

  it('isolates synchronization by tenant and registered provider account', async () => {
    const primary = new SynchronizingProvider();
    const secondary = new SynchronizingProvider();
    const { payable, storage } = await setupCatalogSyncProviders({ primary, secondary });
    const tenantAProduct = await payable.products('tenant-a').create({ name: 'Tenant A' });
    const tenantBProduct = await payable.products('tenant-b').create({ name: 'Tenant B' });

    await payable.catalogSync('primary', 'tenant-a').requestProduct(tenantAProduct.id);
    await payable.catalogSync('secondary', 'tenant-a').requestProduct(tenantAProduct.id);
    await payable.catalogSync('primary', 'tenant-b').requestProduct(tenantBProduct.id);

    await expect(
      storage.productProviderBindings.listByProductId(tenantAProduct.id, 'tenant-a'),
    ).resolves.toHaveLength(2);
    await expect(
      storage.catalogSynchronizations.findByResource(
        'product',
        tenantAProduct.id,
        'primary',
        'tenant-b',
      ),
    ).resolves.toBeNull();
    await expect(
      storage.catalogSynchronizations.findByResource(
        'product',
        tenantAProduct.id,
        'secondary',
        'tenant-a',
      ),
    ).resolves.toMatchObject({ provider: 'secondary', tenantId: 'tenant-a' });
  });
});
