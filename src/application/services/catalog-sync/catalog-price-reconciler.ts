import { isCatalogReadCapable } from '../../../domain/contracts/catalog-provider.contract';
import type { CatalogSynchronizationPatch } from '../../../domain/contracts/catalog-synchronization-repository.contract';
import type { CanonicalPrice } from '../../../domain/entities/canonical-price.entity';
import type { CatalogSynchronization } from '../../../domain/entities/catalog-synchronization.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { CatalogReconciliationSource } from './catalog-reconciler';
import { recordCatalogSyncTransition } from './catalog-sync-transitions';

export class CatalogPriceReconciler {
  constructor(private readonly dependencies: BillingDependencies) {}

  async price(
    priceId: string,
    source: CatalogReconciliationSource = 'manual',
  ): Promise<CatalogSynchronization> {
    const storage = this.storage();
    const tenantId = this.dependencies.tenantId ?? null;
    const price = await storage.canonicalPrices?.findById(priceId, tenantId);
    if (!price) {
      throw new PayableError(`Price not found: ${priceId}`, {
        code: 'PRICE_NOT_FOUND',
        context: { priceId },
      });
    }
    const binding = await storage.priceProviderBindings?.findByPriceAndProvider(
      price.id,
      this.dependencies.providerName,
      tenantId,
    );
    const synchronization = await this.repository().findByResource(
      'price',
      price.id,
      this.dependencies.providerName,
      tenantId,
    );
    if (!binding || !synchronization) {
      throw new PayableError('Catalog synchronization binding is required for reconciliation', {
        code: 'CATALOG_SYNC_BINDING_REQUIRED',
        context: { resourceType: 'price', resourceId: price.id },
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
      const remote = await provider.retrievePrice(binding.providerPriceId);
      return this.transition(
        synchronization,
        {
          status: 'reconciled',
          reconciliationState: priceMatches(price, remote) ? 'in_sync' : 'stale_local',
          providerResourceVersion: remote.providerVersion ?? null,
          lastErrorCode: null,
          lastAttemptedAt: this.dependencies.clock.now(),
        },
        source,
      );
    } catch (error) {
      const missing = error instanceof PayableError && error.code === 'PRICE_NOT_FOUND';
      return this.transition(
        synchronization,
        {
          status: missing ? 'reconciled' : 'failed',
          reconciliationState: missing ? 'missing_remote' : 'required',
          providerResourceVersion: missing ? null : synchronization.providerResourceVersion,
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

function priceMatches(
  local: CanonicalPrice,
  remote: {
    unitAmount: { amount(): number; currency(): string };
    interval: string | null;
    intervalCount: number | null;
    description: string | null;
    active: boolean;
    lookupKey: string | null;
  },
): boolean {
  return (
    local.unitAmount === remote.unitAmount.amount() &&
    local.currency === remote.unitAmount.currency() &&
    local.interval === remote.interval &&
    local.intervalCount === remote.intervalCount &&
    local.description === remote.description &&
    local.active === remote.active &&
    local.lookupKey === remote.lookupKey
  );
}
