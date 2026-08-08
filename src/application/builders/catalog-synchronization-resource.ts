import type { QueueDriver } from '../../domain/contracts/queue-driver.contract';
import type { CatalogSynchronization } from '../../domain/entities/catalog-synchronization.entity';
import { CatalogPriceReconciler } from '../services/catalog-sync/catalog-price-reconciler';
import {
  CatalogReconciler,
  type CatalogReconciliationSource,
} from '../services/catalog-sync/catalog-reconciler';
import { CatalogSyncRequester } from '../services/catalog-sync/catalog-sync-requester';
import { CatalogSyncRetrier } from '../services/catalog-sync/catalog-sync-retrier';
import type { BillingDependencies } from './billing-dependencies';

export class CatalogSynchronizationResource {
  private readonly requester: CatalogSyncRequester;
  private readonly retrier: CatalogSyncRetrier;
  private readonly reconciler: CatalogReconciler;
  private readonly priceReconciler: CatalogPriceReconciler;

  constructor(dependencies: BillingDependencies, queue: QueueDriver) {
    this.requester = new CatalogSyncRequester(dependencies, queue);
    this.retrier = new CatalogSyncRetrier(dependencies, queue);
    this.reconciler = new CatalogReconciler(dependencies);
    this.priceReconciler = new CatalogPriceReconciler(dependencies);
  }

  requestProduct(productId: string): Promise<CatalogSynchronization> {
    return this.requester.product(productId);
  }

  requestPrice(priceId: string): Promise<CatalogSynchronization> {
    return this.requester.price(priceId);
  }

  retryProduct(productId: string): Promise<CatalogSynchronization> {
    return this.retrier.product(productId);
  }

  retryPrice(priceId: string): Promise<CatalogSynchronization> {
    return this.retrier.price(priceId);
  }

  reconcileProduct(
    productId: string,
    source: CatalogReconciliationSource = 'manual',
  ): Promise<CatalogSynchronization> {
    return this.reconciler.product(productId, source);
  }

  reconcilePrice(
    priceId: string,
    source: CatalogReconciliationSource = 'manual',
  ): Promise<CatalogSynchronization> {
    return this.priceReconciler.price(priceId, source);
  }
}
