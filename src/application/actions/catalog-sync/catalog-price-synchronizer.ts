import {
  catalogSyncSemantics,
  isCatalogPriceCreateCapable,
  isCatalogPriceLifecycleCapable,
  isCatalogPriceUpdateCapable,
} from '../../../domain/contracts/catalog-provider.contract';
import type { CatalogSynchronizationPatch } from '../../../domain/contracts/catalog-synchronization-repository.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { CanonicalPrice } from '../../../domain/entities/canonical-price.entity';
import type { CatalogSynchronization } from '../../../domain/entities/catalog-synchronization.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { Money } from '../../../domain/value-objects/money';
import type { CatalogSyncDependencies } from '../../builders/catalog-sync-dependencies';
import { recordCatalogSyncTransition } from '../../services/catalog-sync/catalog-sync-transitions';
import { CatalogProductDependency } from './catalog-product-dependency';
import { CatalogSyncCommitter } from './catalog-sync-committer';
import type { ProcessCatalogSyncJobPayload } from './catalog-sync-job';

export class CatalogPriceSynchronizer {
  constructor(private readonly dependencies: CatalogSyncDependencies) {}

  async handle(payload: ProcessCatalogSyncJobPayload): Promise<void> {
    const storage = this.storage();
    const price = await storage.canonicalPrices?.findById(payload.resourceId, payload.tenantId);
    if (!price) {
      throw new PayableError(`Price not found: ${payload.resourceId}`, {
        code: 'PRICE_NOT_FOUND',
        context: { priceId: payload.resourceId },
      });
    }
    const synchronization = await this.repository().findByResource(
      'price',
      price.id,
      payload.providerName,
      payload.tenantId,
    );
    if (
      !synchronization ||
      synchronization.status === 'succeeded' ||
      synchronization.canonicalVersion !== payload.canonicalVersion ||
      synchronization.idempotencyKey !== payload.idempotencyKey ||
      price.updatedAt.toISOString() !== payload.canonicalVersion
    ) {
      return;
    }
    if (synchronization.reconciliationState === 'required') {
      throw new PayableError('Catalog synchronization requires reconciliation before retrying', {
        code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
        context: { resourceType: 'price', resourceId: price.id },
      });
    }
    const claimed = await this.repository().claimGeneration(
      'price',
      price.id,
      payload.providerName,
      payload.canonicalVersion,
      payload.idempotencyKey,
      payload.tenantId,
      this.dependencies.clock.now(),
    );
    if (!claimed) return;
    if (!this.supportsOperation(claimed, price)) {
      await this.transition(claimed, payload.correlationId, {
        status: 'skipped',
        reconciliationState: 'unsupported',
        lastErrorCode: 'CATALOG_SYNC_OPERATION_UNSUPPORTED',
      });
      return;
    }
    const product = await storage.canonicalProducts?.findById(price.productId, payload.tenantId);
    if (!product) {
      throw new PayableError(`Product not found: ${price.productId}`, {
        code: 'PRODUCT_NOT_FOUND',
        context: { productId: price.productId },
      });
    }
    const productBinding = await new CatalogProductDependency(this.dependencies).ensure(
      product,
      payload,
    );
    if (!productBinding) {
      await this.transition(claimed, payload.correlationId, {
        status: 'skipped',
        reconciliationState: 'unsupported',
        lastErrorCode: 'CATALOG_SYNC_PARENT_UNAVAILABLE',
      });
      return;
    }
    const provider = this.dependencies.provider;
    const committer = new CatalogSyncCommitter(this.dependencies);
    if (await committer.recoverPrice(claimed, payload.correlationId)) {
      return;
    }
    try {
      const remote = await this.mutate(claimed, price, productBinding.providerProductId, {
        correlationId: payload.correlationId,
        tenantId: payload.tenantId,
        idempotencyKey: claimed.idempotencyKey,
      });
      try {
        await committer.price(claimed, remote, payload.correlationId);
      } catch (error) {
        await committer
          .rememberRemote(
            claimed,
            remote.providerPriceId,
            remote.providerVersion,
            payload.correlationId,
          )
          .catch(() => {});
        await committer
          .recordOrphan(
            claimed,
            remote.providerPriceId,
            remote.providerVersion,
            payload.correlationId,
          )
          .catch(() => {});
        if (error instanceof PayableError && error.code === 'CATALOG_SYNC_STALE_GENERATION') {
          return;
        }
        throw new PayableError('Provider price succeeded but local persistence failed', {
          code: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
          cause: error,
          context: {
            providerResourceId: remote.providerPriceId,
            providerResourceVersion: remote.providerVersion ?? null,
            canonicalVersion: claimed.canonicalVersion,
            idempotencyKey: claimed.idempotencyKey,
          },
        });
      }
    } catch (error) {
      await this.transition(claimed, payload.correlationId, {
        status: 'failed',
        reconciliationState: provider.capabilities().has('catalogIdempotency')
          ? 'pending'
          : 'required',
        lastErrorCode: error instanceof PayableError ? error.code : 'CATALOG_SYNC_PROVIDER_FAILED',
      }).catch(() => {});
      throw error;
    }
  }

  private supportsOperation(
    synchronization: CatalogSynchronization,
    price: CanonicalPrice,
  ): boolean {
    const provider = this.dependencies.provider;
    const capabilities = provider.capabilities();
    if (synchronization.operation === 'create') {
      return capabilities.has('catalogPriceCreate') && isCatalogPriceCreateCapable(provider);
    }
    if (synchronization.operation === 'update') {
      return (
        (price.description !== null ||
          catalogSyncSemantics(provider)?.clearPriceDescription !== false) &&
        capabilities.has('catalogPriceUpdate') &&
        isCatalogPriceUpdateCapable(provider)
      );
    }
    if (synchronization.operation === 'archive') {
      return capabilities.has('catalogPriceArchive') && isCatalogPriceLifecycleCapable(provider);
    }
    return capabilities.has('catalogPriceReactivate') && isCatalogPriceLifecycleCapable(provider);
  }

  private mutate(
    synchronization: CatalogSynchronization,
    price: CanonicalPrice,
    providerProductId: string,
    context: OperationContext,
  ): Promise<PriceDTO> {
    const provider = this.dependencies.provider;
    if (synchronization.operation === 'create' && isCatalogPriceCreateCapable(provider)) {
      return provider.createPrice(
        {
          providerProductId,
          unitAmount: Money.of(price.unitAmount, price.currency),
          interval: price.interval ?? undefined,
          intervalCount: price.intervalCount ?? undefined,
          description: price.description ?? undefined,
          lookupKey: price.lookupKey ?? undefined,
        },
        context,
      );
    }
    if (synchronization.operation === 'update' && isCatalogPriceUpdateCapable(provider)) {
      return provider.updatePrice(
        {
          providerPriceId: this.providerResourceId(synchronization),
          description: price.description,
        },
        context,
      );
    }
    if (synchronization.operation === 'archive' && isCatalogPriceLifecycleCapable(provider)) {
      return provider.setPriceActive(this.providerResourceId(synchronization), false, context);
    }
    if (isCatalogPriceLifecycleCapable(provider)) {
      return provider.setPriceActive(this.providerResourceId(synchronization), true, context);
    }
    throw new PayableError('Catalog price synchronization operation is unsupported', {
      code: 'CATALOG_SYNC_OPERATION_UNSUPPORTED',
    });
  }

  private providerResourceId(synchronization: CatalogSynchronization): string {
    if (!synchronization.providerResourceId) {
      throw new PayableError('Catalog synchronization requires a provider resource binding', {
        code: 'CATALOG_SYNC_BINDING_REQUIRED',
      });
    }
    return synchronization.providerResourceId;
  }

  private async transition(
    synchronization: CatalogSynchronization,
    correlationId: string,
    patch: CatalogSynchronizationPatch,
  ): Promise<void> {
    await this.storage().transaction(async (repositories) => {
      const repository = repositories.catalogSynchronizations;
      if (!repository) {
        throw this.storageError();
      }
      const updated = await repository.updateIfCurrent(
        synchronization.resourceType,
        synchronization.resourceId,
        synchronization.provider,
        synchronization.canonicalVersion,
        synchronization.idempotencyKey,
        patch,
        synchronization.tenantId,
      );
      if (updated) await recordCatalogSyncTransition(repositories, updated, correlationId);
    });
  }

  private repository() {
    const repository = this.storage().catalogSynchronizations;
    if (!repository) {
      throw this.storageError();
    }
    return repository;
  }

  private storage() {
    if (!this.dependencies.storage) {
      throw this.storageError();
    }
    return this.dependencies.storage;
  }

  private storageError(): PayableError {
    return new PayableError('Catalog synchronization requires compatible storage', {
      code: 'CATALOG_SYNC_STORAGE_REQUIRED',
    });
  }
}
