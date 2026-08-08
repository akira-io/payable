import { isCatalogReadCapable } from '../../../domain/contracts/catalog-provider.contract';
import type { CatalogSynchronizationPatch } from '../../../domain/contracts/catalog-synchronization-repository.contract';
import type { CanonicalProduct } from '../../../domain/entities/canonical-product.entity';
import type { CatalogSynchronization } from '../../../domain/entities/catalog-synchronization.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { recordCatalogSyncTransition } from './catalog-sync-transitions';

export type CatalogReconciliationSource = 'manual' | 'webhook';

export class CatalogReconciler {
  constructor(private readonly dependencies: BillingDependencies) {}

  async product(
    productId: string,
    source: CatalogReconciliationSource = 'manual',
  ): Promise<CatalogSynchronization> {
    const storage = this.storage();
    const tenantId = this.dependencies.tenantId ?? null;
    const product = await storage.canonicalProducts?.findById(productId, tenantId);
    if (!product) {
      throw new PayableError(`Product not found: ${productId}`, {
        code: 'PRODUCT_NOT_FOUND',
        context: { productId },
      });
    }
    const binding = await storage.productProviderBindings?.findByProductAndProvider(
      product.id,
      this.dependencies.providerName,
      tenantId,
    );
    const synchronization = await this.repository().findByResource(
      'product',
      product.id,
      this.dependencies.providerName,
      tenantId,
    );
    if (!binding || !synchronization) {
      throw new PayableError('Catalog synchronization binding is required for reconciliation', {
        code: 'CATALOG_SYNC_BINDING_REQUIRED',
        context: { resourceType: 'product', resourceId: product.id },
      });
    }
    const provider = this.dependencies.provider;
    if (!provider.capabilities().has('catalogRead') || !isCatalogReadCapable(provider)) {
      return this.transition(
        synchronization,
        {
          status: 'skipped',
          reconciliationState: 'unsupported',
          lastErrorCode: 'CATALOG_SYNC_RECONCILIATION_UNSUPPORTED',
        },
        source,
      );
    }

    try {
      const remote = await provider.retrieveProduct(binding.providerProductId);
      return this.transition(
        synchronization,
        {
          status: 'reconciled',
          reconciliationState: productMatches(product, remote) ? 'in_sync' : 'stale_local',
          providerResourceVersion: remote.providerVersion ?? null,
          lastErrorCode: null,
          lastAttemptedAt: this.dependencies.clock.now(),
        },
        source,
      );
    } catch (error) {
      if (error instanceof PayableError && error.code === 'PRODUCT_NOT_FOUND') {
        return this.transition(
          synchronization,
          {
            status: 'reconciled',
            reconciliationState: 'missing_remote',
            providerResourceVersion: null,
            lastErrorCode: error.code,
            lastAttemptedAt: this.dependencies.clock.now(),
          },
          source,
        );
      }
      return this.transition(
        synchronization,
        {
          status: 'failed',
          reconciliationState: 'required',
          lastErrorCode:
            error instanceof PayableError ? error.code : 'CATALOG_SYNC_RECONCILIATION_FAILED',
          lastAttemptedAt: this.dependencies.clock.now(),
        },
        source,
      );
    }
  }

  private async transition(
    synchronization: CatalogSynchronization,
    patch: CatalogSynchronizationPatch,
    source: CatalogReconciliationSource,
  ): Promise<CatalogSynchronization> {
    const correlationId = CorrelationId.generate().toString();
    return this.storage().transaction(async (repositories) => {
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
      await recordCatalogSyncTransition(repositories, updated, correlationId, { source });
      return updated;
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

function productMatches(
  local: CanonicalProduct,
  remote: {
    name: string;
    description: string | null;
    active: boolean;
    metadata: Record<string, string> | null;
  },
): boolean {
  return (
    local.name === remote.name &&
    local.description === remote.description &&
    local.active === remote.active &&
    JSON.stringify(local.metadata) === JSON.stringify(remote.metadata)
  );
}
