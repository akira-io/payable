import {
  catalogSyncSemantics,
  isCatalogProductCreateCapable,
  isCatalogProductLifecycleCapable,
  isCatalogProductUpdateCapable,
} from '../../../domain/contracts/catalog-provider.contract';
import type { CatalogSynchronizationPatch } from '../../../domain/contracts/catalog-synchronization-repository.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { CanonicalProduct } from '../../../domain/entities/canonical-product.entity';
import type { CatalogSynchronization } from '../../../domain/entities/catalog-synchronization.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import type { CatalogSyncDependencies } from '../../builders/catalog-sync-dependencies';
import { recordCatalogSyncTransition } from '../../services/catalog-sync/catalog-sync-transitions';
import { CatalogSyncCommitter } from './catalog-sync-committer';
import type { ProcessCatalogSyncJobPayload } from './catalog-sync-job';

export class CatalogProductSynchronizer {
  constructor(private readonly dependencies: CatalogSyncDependencies) {}

  async handle(payload: ProcessCatalogSyncJobPayload): Promise<void> {
    const storage = this.storage();
    const synchronization = await this.repository().findByResource(
      'product',
      payload.resourceId,
      payload.providerName,
      payload.tenantId,
    );
    if (
      !synchronization ||
      synchronization.status === 'succeeded' ||
      synchronization.canonicalVersion !== payload.canonicalVersion ||
      synchronization.idempotencyKey !== payload.idempotencyKey
    ) {
      return;
    }
    const product = await storage.canonicalProducts?.findById(payload.resourceId, payload.tenantId);
    if (!product) {
      throw new PayableError(`Product not found: ${payload.resourceId}`, {
        code: 'PRODUCT_NOT_FOUND',
        context: { productId: payload.resourceId },
      });
    }
    if (product.updatedAt.toISOString() !== payload.canonicalVersion) {
      return;
    }
    if (synchronization.reconciliationState === 'required') {
      throw new PayableError('Catalog synchronization requires reconciliation before retrying', {
        code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
        context: { resourceType: 'product', resourceId: product.id },
      });
    }
    const claimed = await this.repository().claimGeneration(
      'product',
      product.id,
      payload.providerName,
      payload.canonicalVersion,
      payload.idempotencyKey,
      payload.tenantId,
      this.dependencies.clock.now(),
      globalThis.crypto.randomUUID(),
      new Date(this.dependencies.clock.now().getTime() + CATALOG_SYNC_LEASE_MS),
      this.dependencies.provider.capabilities().has('catalogIdempotency'),
    );
    if (!claimed) {
      return;
    }
    if (!this.supportsOperation(claimed, product)) {
      await this.transition(claimed, payload.correlationId, {
        status: 'skipped',
        reconciliationState: 'unsupported',
        lastErrorCode: 'CATALOG_SYNC_OPERATION_UNSUPPORTED',
      });
      return;
    }
    const committer = new CatalogSyncCommitter(this.dependencies);
    if (await committer.recoverProduct(claimed, payload.correlationId)) {
      return;
    }

    try {
      const remote = await this.mutate(claimed, product, {
        correlationId: payload.correlationId,
        tenantId: payload.tenantId,
        idempotencyKey: claimed.idempotencyKey,
      });
      try {
        await committer.product(claimed, remote, payload.correlationId);
      } catch (error) {
        await committer
          .rememberRemote(
            claimed,
            remote.providerProductId,
            remote.providerVersion,
            payload.correlationId,
          )
          .catch(() => {});
        await committer
          .recordOrphan(
            claimed,
            remote.providerProductId,
            remote.providerVersion,
            payload.correlationId,
          )
          .catch(() => {});
        if (error instanceof PayableError && error.code === 'CATALOG_SYNC_STALE_GENERATION') {
          return;
        }
        throw new PayableError('Provider product succeeded but local persistence failed', {
          code: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
          cause: error,
          context: {
            providerResourceId: remote.providerProductId,
            providerResourceVersion: remote.providerVersion ?? null,
            canonicalVersion: claimed.canonicalVersion,
            idempotencyKey: claimed.idempotencyKey,
          },
        });
      }
    } catch (error) {
      await this.fail(claimed, payload.correlationId, error);
      throw error;
    }
  }

  private supportsOperation(
    synchronization: CatalogSynchronization,
    product: CanonicalProduct,
  ): boolean {
    const capabilities = this.dependencies.provider.capabilities();
    const semantics = catalogSyncSemantics(this.dependencies.provider);
    if (synchronization.operation === 'create') {
      return (
        (product.active || semantics?.inactiveProductCreate !== false) &&
        capabilities.has('catalogProductCreate') &&
        isCatalogProductCreateCapable(this.dependencies.provider)
      );
    }
    if (synchronization.operation === 'archive') {
      return (
        capabilities.has('catalogProductArchive') &&
        isCatalogProductLifecycleCapable(this.dependencies.provider)
      );
    }
    if (synchronization.operation === 'reactivate') {
      return (
        capabilities.has('catalogProductReactivate') &&
        isCatalogProductLifecycleCapable(this.dependencies.provider)
      );
    }
    return (
      (product.description !== null || semantics?.clearProductDescription !== false) &&
      (product.metadata !== null || semantics?.clearProductMetadata !== false) &&
      capabilities.has('catalogProductUpdate') &&
      isCatalogProductUpdateCapable(this.dependencies.provider)
    );
  }

  private mutate(
    synchronization: CatalogSynchronization,
    product: CanonicalProduct,
    context: OperationContext,
  ): Promise<ProductDTO> {
    const provider = this.dependencies.provider;
    if (synchronization.operation === 'archive' && isCatalogProductLifecycleCapable(provider)) {
      return provider.setProductActive(this.providerResourceId(synchronization), false, context);
    }
    if (synchronization.operation === 'reactivate' && isCatalogProductLifecycleCapable(provider)) {
      return provider.setProductActive(this.providerResourceId(synchronization), true, context);
    }
    if (synchronization.operation === 'create' && isCatalogProductCreateCapable(provider)) {
      return provider.createProduct(
        {
          name: product.name,
          description: product.description ?? undefined,
          active: product.active,
          metadata: product.metadata ?? undefined,
        },
        context,
      );
    }
    if (isCatalogProductUpdateCapable(provider)) {
      return provider.updateProduct(
        {
          providerProductId: this.providerResourceId(synchronization),
          name: product.name,
          description: product.description,
          metadata: product.metadata,
          active: product.active,
        },
        context,
      );
    }
    throw new PayableError('Catalog product synchronization operation is unsupported', {
      code: 'CATALOG_SYNC_OPERATION_UNSUPPORTED',
    });
  }

  private async fail(
    synchronization: CatalogSynchronization,
    correlationId: string,
    error: unknown,
  ): Promise<void> {
    await this.transition(synchronization, correlationId, {
      status: 'failed',
      reconciliationState: this.dependencies.provider.capabilities().has('catalogIdempotency')
        ? 'pending'
        : 'required',
      lastErrorCode: error instanceof PayableError ? error.code : 'CATALOG_SYNC_PROVIDER_FAILED',
    }).catch(() => {});
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
        synchronization.attemptOwnerId ?? undefined,
      );
      if (updated) await recordCatalogSyncTransition(repositories, updated, correlationId);
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

const CATALOG_SYNC_LEASE_MS = 30_000;
