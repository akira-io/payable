import {
  isCatalogLifecycleCapable,
  isCatalogProductCreateCapable,
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
    if (!synchronization || synchronization.status === 'succeeded') {
      return;
    }
    const product = await storage.canonicalProducts?.findById(payload.resourceId, payload.tenantId);
    if (!product) {
      throw new PayableError(`Product not found: ${payload.resourceId}`, {
        code: 'PRODUCT_NOT_FOUND',
        context: { productId: payload.resourceId },
      });
    }
    if (!this.supportsOperation(synchronization)) {
      await this.transition(synchronization, payload.correlationId, {
        status: 'skipped',
        reconciliationState: 'unsupported',
        lastErrorCode: 'CATALOG_SYNC_OPERATION_UNSUPPORTED',
      });
      return;
    }
    const committer = new CatalogSyncCommitter(this.dependencies);
    if (await committer.recoverProduct(synchronization, payload.correlationId)) {
      return;
    }

    await this.repository().update(
      'product',
      product.id,
      payload.providerName,
      { lastAttemptedAt: this.dependencies.clock.now() },
      payload.tenantId,
    );

    try {
      const remote = await this.mutate(synchronization, product, {
        correlationId: payload.correlationId,
        tenantId: payload.tenantId,
        idempotencyKey: synchronization.idempotencyKey,
      });
      try {
        await committer.product(synchronization, remote, payload.correlationId);
      } catch (error) {
        await committer
          .rememberRemote(
            synchronization,
            remote.providerProductId,
            remote.providerVersion,
            payload.correlationId,
          )
          .catch(() => {});
        throw new PayableError('Provider product succeeded but local persistence failed', {
          code: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
          cause: error,
        });
      }
    } catch (error) {
      await this.fail(synchronization, payload.correlationId, error);
      throw error;
    }
  }

  private supportsOperation(synchronization: CatalogSynchronization): boolean {
    const capabilities = this.dependencies.provider.capabilities();
    if (synchronization.operation === 'create') {
      return (
        capabilities.has('catalogProductCreate') &&
        isCatalogProductCreateCapable(this.dependencies.provider)
      );
    }
    if (synchronization.operation === 'archive') {
      return (
        capabilities.has('catalogProductArchive') &&
        isCatalogLifecycleCapable(this.dependencies.provider)
      );
    }
    if (synchronization.operation === 'reactivate') {
      return (
        capabilities.has('catalogProductReactivate') &&
        isCatalogLifecycleCapable(this.dependencies.provider)
      );
    }
    return (
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
    if (synchronization.operation === 'archive' && isCatalogLifecycleCapable(provider)) {
      return provider.setProductActive(this.providerResourceId(synchronization), false, context);
    }
    if (synchronization.operation === 'reactivate' && isCatalogLifecycleCapable(provider)) {
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
          description: product.description ?? undefined,
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
      const updated = await repository.update(
        synchronization.resourceType,
        synchronization.resourceId,
        synchronization.provider,
        patch,
        synchronization.tenantId,
      );
      await recordCatalogSyncTransition(repositories, updated, correlationId);
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
