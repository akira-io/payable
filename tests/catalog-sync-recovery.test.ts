import { afterEach, describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import { Money } from '../src/domain/value-objects/money';
import {
  closeCatalogSyncDatabases,
  FlakyPriceProvider,
  FlakySynchronizingProvider,
  NonIdempotentFlakyPriceProvider,
  NonIdempotentFlakyProvider,
  setupCatalogSync,
} from './support/catalog-sync-fixture';

afterEach(closeCatalogSyncDatabases);

describe('catalog synchronization recovery', () => {
  it('retries a native-idempotent product with the same derived key', async () => {
    const provider = new FlakySynchronizingProvider();
    const { database, payable, storage } = await setupCatalogSync(provider);
    const product = await payable.products().create({ name: 'Retryable' });
    const synchronization = payable.catalogSync('stripe-primary');

    await expect(synchronization.requestProduct(product.id)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(
      storage.catalogSynchronizations.findByResource('product', product.id, 'stripe-primary', null),
    ).resolves.toMatchObject({ status: 'failed', reconciliationState: 'pending', retryCount: 0 });
    await expect(synchronization.retryProduct(product.id)).resolves.toMatchObject({
      status: 'succeeded',
      retryCount: 1,
      providerResourceId: 'prod_recovered',
    });
    expect(new Set(provider.productIdempotencyKeys).size).toBe(1);
    const eventTypes = await database('payable_outbox_events').pluck('event_type');
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'catalog.synchronization.requested.v1',
        'catalog.synchronization.failed.v1',
        'catalog.synchronization.retrying.v1',
        'catalog.synchronization.succeeded.v1',
      ]),
    );
  });

  it('retries a native-idempotent price with the same derived key', async () => {
    const provider = new FlakyPriceProvider();
    const { payable } = await setupCatalogSync(provider);
    const product = await payable.products().create({ name: 'Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });
    const synchronization = payable.catalogSync('stripe-primary');

    await expect(synchronization.requestPrice(price.id)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(synchronization.retryPrice(price.id)).resolves.toMatchObject({
      status: 'succeeded',
      retryCount: 1,
      providerResourceId: 'price_recovered',
    });
    expect(new Set(provider.priceIdempotencyKeys).size).toBe(1);
  });

  it('requires reconciliation before repeating an ambiguous request', async () => {
    const provider = new NonIdempotentFlakyProvider();
    const { payable } = await setupCatalogSync(provider);
    const product = await payable.products().create({ name: 'Ambiguous' });
    const synchronization = payable.catalogSync('stripe-primary');

    await expect(synchronization.requestProduct(product.id)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(synchronization.retryProduct(product.id)).rejects.toMatchObject({
      code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
    });
    await expect(synchronization.requestProduct(product.id)).rejects.toMatchObject({
      code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
    });
    expect(provider.productCreates).toBe(1);
  });

  it('requires reconciliation before repeating an ambiguous price request', async () => {
    const provider = new NonIdempotentFlakyPriceProvider();
    const { payable } = await setupCatalogSync(provider);
    const product = await payable.products().create({ name: 'Parent' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(1000, 'EUR'),
      type: 'one_time',
    });
    const synchronization = payable.catalogSync('stripe-primary');

    await expect(synchronization.requestPrice(price.id)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(synchronization.requestPrice(price.id)).rejects.toMatchObject({
      code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
    });
    expect(provider.priceCreates).toBe(1);
  });

  it('preserves confirmed remote evidence when every local recovery write fails', async () => {
    const { payable, storage } = await setupCatalogSync();
    const product = await payable.products().create({ name: 'Evidence' });
    const originalTransaction = storage.transaction.bind(storage);
    let transactionCount = 0;
    storage.transaction = async (work) => {
      transactionCount += 1;
      if (transactionCount >= 2 && transactionCount <= 4) {
        throw new Error('simulated persistence outage');
      }
      return originalTransaction(work);
    };

    await expect(
      payable.catalogSync('stripe-primary').requestProduct(product.id),
    ).rejects.toMatchObject({
      code: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
      context: {
        providerResourceId: 'prod_1',
        providerResourceVersion: null,
        canonicalVersion: product.updatedAt.toISOString(),
      },
    });
  });

  it('recovers a local commit failure without another provider call', async () => {
    const { payable, provider, storage } = await setupCatalogSync();
    const product = await payable.products().create({ name: 'Recoverable' });
    const originalTransaction = storage.transaction.bind(storage);
    let transactionCount = 0;
    storage.transaction = async (work) => {
      transactionCount += 1;
      if (transactionCount === 2) {
        throw new Error('simulated local commit failure');
      }
      return originalTransaction(work);
    };
    const synchronization = payable.catalogSync('stripe-primary');

    await expect(synchronization.requestProduct(product.id)).rejects.toMatchObject({
      code: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
    });
    await expect(synchronization.retryProduct(product.id)).resolves.toMatchObject({
      status: 'succeeded',
      providerResourceId: 'prod_1',
    });
    expect(provider.productCreates).toBe(1);
  });

  it('records missing and stale remote products without changing canonical state', async () => {
    const { payable, provider, storage } = await setupCatalogSync();
    const product = await payable.products().create({ name: 'Product' });
    const synchronization = payable.catalogSync('stripe-primary');
    await synchronization.requestProduct(product.id);

    provider.remoteProduct = new PayableError('Missing remote product', {
      code: 'PRODUCT_NOT_FOUND',
    });
    await expect(synchronization.reconcileProduct(product.id)).resolves.toMatchObject({
      status: 'reconciled',
      reconciliationState: 'missing_remote',
    });
    provider.remoteProduct = undefined;
    await expect(synchronization.requestProduct(product.id)).resolves.toMatchObject({
      operation: 'create',
      status: 'succeeded',
      providerResourceId: 'prod_2',
    });
    await expect(
      storage.productProviderBindings.findByProductAndProvider(product.id, 'stripe-primary', null),
    ).resolves.toMatchObject({ providerProductId: 'prod_2' });
    provider.remoteProduct = {
      providerProductId: 'prod_2',
      providerVersion: 'provider-v2',
      name: 'Externally changed',
      description: null,
      active: true,
      metadata: null,
    };
    await expect(synchronization.reconcileProduct(product.id, 'webhook')).resolves.toMatchObject({
      status: 'reconciled',
      reconciliationState: 'stale_local',
      providerResourceVersion: 'provider-v2',
    });
    await expect(payable.products().retrieve(product.id)).resolves.toMatchObject({
      name: 'Product',
    });
    const audit = await storage.auditLogs.list({
      resourceId: product.id,
      actions: ['catalog.synchronization.reconciled'],
    });
    expect(audit.map(({ metadata }) => metadata?.source)).toEqual(
      expect.arrayContaining(['manual', 'webhook']),
    );
  });

  it('records provider price drift without changing the canonical price', async () => {
    const { payable, provider } = await setupCatalogSync();
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
    provider.remotePrice = {
      providerPriceId: 'price_1',
      providerProductId: 'prod_1',
      providerVersion: 'provider-v2',
      unitAmount: Money.of(3900, 'EUR'),
      interval: 'month',
      intervalCount: 1,
      description: 'Changed remotely',
      active: true,
      lookupKey: null,
    };

    await expect(synchronization.reconcilePrice(price.id, 'webhook')).resolves.toMatchObject({
      status: 'reconciled',
      reconciliationState: 'stale_local',
    });
    await expect(payable.prices().retrieve(price.id)).resolves.toMatchObject({
      unitAmount: 2900,
      description: 'Monthly',
    });
  });
});
