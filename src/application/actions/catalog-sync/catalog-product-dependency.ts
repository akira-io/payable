import type { CanonicalProduct } from '../../../domain/entities/canonical-product.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import type { CatalogSyncDependencies } from '../../builders/catalog-sync-dependencies';
import { deriveCatalogSyncKey } from '../../services/catalog-sync/catalog-sync-idempotency-key';
import { recordCatalogSyncTransition } from '../../services/catalog-sync/catalog-sync-transitions';
import { CatalogProductSynchronizer } from './catalog-product-synchronizer';
import type { ProcessCatalogSyncJobPayload } from './catalog-sync-job';

export class CatalogProductDependency {
  constructor(private readonly dependencies: CatalogSyncDependencies) {}

  async ensure(product: CanonicalProduct, payload: ProcessCatalogSyncJobPayload) {
    const storage = this.storage();
    const currentBinding = await storage.productProviderBindings?.findByProductAndProvider(
      product.id,
      payload.providerName,
      payload.tenantId,
    );
    if (currentBinding) {
      return currentBinding;
    }
    const repository = storage.catalogSynchronizations;
    if (!repository) {
      throw this.storageError();
    }
    const existing = await repository.findByResource(
      'product',
      product.id,
      payload.providerName,
      payload.tenantId,
    );
    const canonicalVersion = product.updatedAt.toISOString();
    const idempotencyKey = await deriveCatalogSyncKey({
      tenantId: payload.tenantId,
      provider: payload.providerName,
      resourceType: 'product',
      resourceId: product.id,
      operation: 'create',
      canonicalVersion,
    });
    if (existing?.idempotencyKey !== idempotencyKey) {
      await storage.transaction(async (repositories) => {
        const synchronizations = repositories.catalogSynchronizations;
        if (!synchronizations) {
          throw this.storageError();
        }
        const requested = await synchronizations.requestGeneration({
          tenantId: payload.tenantId,
          provider: payload.providerName,
          resourceType: 'product',
          resourceId: product.id,
          operation: 'create',
          canonicalVersion,
          idempotencyKey,
          status: 'requested',
          reconciliationState: 'pending',
          providerResourceId: null,
          providerResourceVersion: null,
          retryCount: existing?.retryCount ?? 0,
          lastErrorCode: null,
          lastAttemptedAt: existing?.lastAttemptedAt ?? null,
          lastSucceededAt: existing?.lastSucceededAt ?? null,
        });
        await recordCatalogSyncTransition(repositories, requested, payload.correlationId);
      });
    }
    await new CatalogProductSynchronizer(this.dependencies).handle({
      ...payload,
      resourceType: 'product',
      resourceId: product.id,
      canonicalVersion,
      idempotencyKey,
    });
    const startedAt = Date.now();
    for (;;) {
      const binding = await storage.productProviderBindings?.findByProductAndProvider(
        product.id,
        payload.providerName,
        payload.tenantId,
      );
      if (binding) return binding;
      const current = await repository.findByResource(
        'product',
        product.id,
        payload.providerName,
        payload.tenantId,
      );
      if (current?.status !== 'processing') return null;
      const leaseDuration = Math.max(
        0,
        (current.leaseExpiresAt?.getTime() ?? this.dependencies.clock.now().getTime()) -
          this.dependencies.clock.now().getTime(),
      );
      if (Date.now() - startedAt >= leaseDuration) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
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
