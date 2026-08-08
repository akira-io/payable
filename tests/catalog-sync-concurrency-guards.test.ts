import { afterEach, describe, expect, it } from 'vitest';
import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../src/domain/contracts/queue-driver.contract';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreateProductInput, ProductDTO } from '../src/domain/dtos/product.dto';
import { Money } from '../src/domain/value-objects/money';
import {
  closeCatalogSyncDatabases,
  FlakySynchronizingProvider,
  NonIdempotentFlakyProvider,
  SynchronizingProvider,
  setupCatalogSync,
} from './support/catalog-sync-fixture';

class DeferredQueue implements QueueDriver {
  readonly inline = false;
  readonly jobs: QueueJob[] = [];
  private readonly handlers = new Map<string, JobHandler>();

  async dispatch<T>(job: QueueJob<T>): Promise<void> {
    this.jobs.push(job);
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler);
  }

  run(index: number): Promise<void> {
    const job = this.jobs[index];
    const handler = job ? this.handlers.get(job.name) : undefined;
    if (!job || !handler) {
      throw new Error(`Queued job is unavailable at index ${index}`);
    }
    return handler(job);
  }
}

class BlockingProductProvider extends SynchronizingProvider {
  private releaseRemote!: () => void;
  private signalStarted!: () => void;
  readonly remoteStarted = new Promise<void>((resolve) => {
    this.signalStarted = resolve;
  });
  private readonly remoteReleased = new Promise<void>((resolve) => {
    this.releaseRemote = resolve;
  });

  release(): void {
    this.releaseRemote();
  }

  override async createProduct(
    input: CreateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.productCreates += 1;
    this.synchronizationOrder.push('product');
    this.lastProductContext = context;
    this.signalStarted();
    await this.remoteReleased;
    return {
      providerProductId: `prod_${this.productCreates}`,
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      metadata: input.metadata ?? null,
    };
  }
}

class NonIdempotentBlockingProductProvider extends BlockingProductProvider {
  constructor() {
    super();
    this.supportedCapabilities.delete('catalogIdempotency');
  }
}

afterEach(closeCatalogSyncDatabases);

describe('catalog synchronization concurrency guards', () => {
  it('does not commit a superseded generation after its provider call returns', async () => {
    const queue = new DeferredQueue();
    const provider = new BlockingProductProvider();
    const { clock, database, payable, storage } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Version one' });
    await payable.catalogSync('stripe-primary').requestProduct(product.id);
    const staleJob = queue.run(0);
    await provider.remoteStarted;

    clock.advance(1_000);
    const updated = await payable.products().update(product.id, { name: 'Version two' });
    await payable.catalogSync('stripe-primary').requestProduct(product.id);
    provider.release();
    await staleJob;

    await expect(
      storage.productProviderBindings.findByProductAndProvider(product.id, 'stripe-primary', null),
    ).resolves.toBeNull();
    await expect(
      storage.catalogSynchronizations.findByResource('product', product.id, 'stripe-primary', null),
    ).resolves.toMatchObject({
      canonicalVersion: updated.updatedAt.toISOString(),
      status: 'requested',
    });
    await expect(database('payable_outbox_events').pluck('event_type')).resolves.toContain(
      'catalog.synchronization.orphaned.v1',
    );
  });

  it('claims one parent product before concurrent price jobs create remotely', async () => {
    const queue = new DeferredQueue();
    const provider = new BlockingProductProvider();
    const { payable, storage } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Shared parent' });
    const firstPrice = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(1000, 'EUR'),
      type: 'one_time',
    });
    const secondPrice = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2000, 'EUR'),
      type: 'one_time',
    });
    await payable.catalogSync('stripe-primary').requestPrice(firstPrice.id);
    await payable.catalogSync('stripe-primary').requestPrice(secondPrice.id);

    const firstJob = queue.run(0);
    const secondJob = queue.run(1);
    await provider.remoteStarted;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(provider.productCreates).toBe(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 550));
    provider.release();
    await Promise.all([firstJob, secondJob]);

    expect(provider.productCreates).toBe(1);
    expect(provider.priceCreates).toBe(2);
    await expect(
      storage.productProviderBindings.listByProductId(product.id, null),
    ).resolves.toHaveLength(1);
  });

  it('blocks an automatic queue retry after an ambiguous provider mutation', async () => {
    const queue = new DeferredQueue();
    const provider = new NonIdempotentFlakyProvider();
    const { payable } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Ambiguous queued product' });
    await payable.catalogSync('stripe-primary').requestProduct(product.id);

    await expect(queue.run(0)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(queue.run(0)).rejects.toMatchObject({
      code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
    });
    expect(provider.productCreates).toBe(1);
  });

  it('rejects a concurrent manual retry while a non-idempotent mutation is processing', async () => {
    const queue = new DeferredQueue();
    const provider = new NonIdempotentBlockingProductProvider();
    const { payable } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Single non-native mutation' });
    const synchronization = payable.catalogSync('stripe-primary');
    await synchronization.requestProduct(product.id);
    const processing = queue.run(0);
    await provider.remoteStarted;

    await expect(synchronization.retryProduct(product.id)).rejects.toMatchObject({
      code: 'CATALOG_SYNC_IN_PROGRESS',
    });
    provider.release();
    await processing;
    expect(provider.productCreates).toBe(1);
  });

  it('reclaims a failed native-idempotent generation on automatic queue retry', async () => {
    const queue = new DeferredQueue();
    const provider = new FlakySynchronizingProvider();
    const { payable, storage } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Retryable queued product' });
    await payable.catalogSync('stripe-primary').requestProduct(product.id);

    await expect(queue.run(0)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(queue.run(0)).resolves.toBeUndefined();
    await expect(
      storage.catalogSynchronizations.findByResource('product', product.id, 'stripe-primary', null),
    ).resolves.toMatchObject({ status: 'succeeded', providerResourceId: 'prod_recovered' });
    expect(new Set(provider.productIdempotencyKeys).size).toBe(1);
  });

  it('uses a new queue dispatch identity for a manual retry', async () => {
    const queue = new DeferredQueue();
    const provider = new FlakySynchronizingProvider();
    const { payable } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Manual retry product' });
    const synchronization = payable.catalogSync('stripe-primary');
    await synchronization.requestProduct(product.id);
    await expect(queue.run(0)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    await synchronization.retryProduct(product.id);

    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs[1]?.idempotencyKey).not.toBe(queue.jobs[0]?.idempotencyKey);
    expect(queue.jobs[1]?.payload).toMatchObject({
      idempotencyKey: (queue.jobs[0]?.payload as { idempotencyKey: string }).idempotencyKey,
    });
  });

  it('transitions a claimed price when ensuring its parent product fails', async () => {
    const queue = new DeferredQueue();
    const provider = new FlakySynchronizingProvider();
    const { payable, storage } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Failing parent' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(1000, 'EUR'),
      type: 'one_time',
    });
    await payable.catalogSync('stripe-primary').requestPrice(price.id);

    await expect(queue.run(0)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(
      storage.catalogSynchronizations.findByResource('price', price.id, 'stripe-primary', null),
    ).resolves.toMatchObject({ status: 'failed', reconciliationState: 'pending' });
  });

  it('reconciles a bound catalog product from a verified provider webhook', async () => {
    const provider = new SynchronizingProvider();
    const { payable, storage } = await setupCatalogSync(provider);
    const product = await payable.products().create({ name: 'Canonical' });
    await payable.catalogSync('stripe-primary').requestProduct(product.id);
    provider.remoteProduct = {
      providerProductId: 'prod_1',
      name: 'Provider changed',
      description: null,
      active: true,
      metadata: null,
      providerVersion: 'remote-v2',
    };
    provider.verifyResult = {
      providerEventId: 'evt_catalog_product',
      type: 'product.updated',
      normalizedType: null,
      data: { id: 'prod_1' },
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    await expect(
      storage.catalogSynchronizations.findByResource('product', product.id, 'stripe-primary', null),
    ).resolves.toMatchObject({
      status: 'reconciled',
      reconciliationState: 'stale_local',
      providerResourceVersion: 'remote-v2',
    });
    const audit = await storage.auditLogs.list({
      resourceId: product.id,
      actions: ['catalog.synchronization.reconciled'],
    });
    expect(audit.at(-1)?.metadata?.source).toBe('webhook');
  });
});
