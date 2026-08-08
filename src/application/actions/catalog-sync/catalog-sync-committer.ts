import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { CatalogSynchronization } from '../../../domain/entities/catalog-synchronization.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import type { CatalogSyncDependencies } from '../../builders/catalog-sync-dependencies';
import { recordCatalogSyncTransition } from '../../services/catalog-sync/catalog-sync-transitions';

export class CatalogSyncCommitter {
  constructor(private readonly dependencies: CatalogSyncDependencies) {}

  async recoverProduct(
    synchronization: CatalogSynchronization,
    correlationId: string,
  ): Promise<boolean> {
    const providerProductId = synchronization.providerResourceId;
    if (!providerProductId) {
      return false;
    }
    const binding = await this.storage().productProviderBindings?.findByProductAndProvider(
      synchronization.resourceId,
      synchronization.provider,
      synchronization.tenantId,
    );
    if (binding) {
      return false;
    }
    await this.product(
      synchronization,
      {
        providerProductId,
        providerVersion: synchronization.providerResourceVersion,
      },
      correlationId,
    );
    return true;
  }

  async recoverPrice(
    synchronization: CatalogSynchronization,
    correlationId: string,
  ): Promise<boolean> {
    const providerPriceId = synchronization.providerResourceId;
    if (!providerPriceId) {
      return false;
    }
    const binding = await this.storage().priceProviderBindings?.findByPriceAndProvider(
      synchronization.resourceId,
      synchronization.provider,
      synchronization.tenantId,
    );
    if (binding) {
      return false;
    }
    await this.price(
      synchronization,
      {
        providerPriceId,
        providerVersion: synchronization.providerResourceVersion,
      },
      correlationId,
    );
    return true;
  }

  async product(
    synchronization: CatalogSynchronization,
    remote: CatalogProductRemoteReference,
    correlationId: string,
  ): Promise<void> {
    await this.storage().transaction(async (repositories) => {
      const bindings = repositories.productProviderBindings;
      const synchronizations = repositories.catalogSynchronizations;
      if (!bindings || !synchronizations) {
        throw this.storageError();
      }
      const binding = await bindings.findByProductAndProvider(
        synchronization.resourceId,
        synchronization.provider,
        synchronization.tenantId,
      );
      if (!binding) {
        await bindings.create({
          tenantId: synchronization.tenantId,
          productId: synchronization.resourceId,
          provider: synchronization.provider,
          providerProductId: remote.providerProductId,
        });
      }
      if (binding && binding.providerProductId !== remote.providerProductId) {
        if (!bindings.updateProviderId) {
          throw this.storageError();
        }
        await bindings.updateProviderId(binding.id, remote.providerProductId);
      }
      await this.succeed(
        repositories,
        synchronization,
        remote.providerProductId,
        remote.providerVersion,
        correlationId,
      );
    });
  }

  async price(
    synchronization: CatalogSynchronization,
    remote: CatalogPriceRemoteReference,
    correlationId: string,
  ): Promise<void> {
    await this.storage().transaction(async (repositories) => {
      const bindings = repositories.priceProviderBindings;
      const synchronizations = repositories.catalogSynchronizations;
      if (!bindings || !synchronizations) {
        throw this.storageError();
      }
      const binding = await bindings.findByPriceAndProvider(
        synchronization.resourceId,
        synchronization.provider,
        synchronization.tenantId,
      );
      if (!binding) {
        await bindings.create({
          tenantId: synchronization.tenantId,
          priceId: synchronization.resourceId,
          provider: synchronization.provider,
          providerPriceId: remote.providerPriceId,
        });
      }
      if (binding && binding.providerPriceId !== remote.providerPriceId) {
        if (!bindings.updateProviderId) {
          throw this.storageError();
        }
        await bindings.updateProviderId(binding.id, remote.providerPriceId);
      }
      await this.succeed(
        repositories,
        synchronization,
        remote.providerPriceId,
        remote.providerVersion,
        correlationId,
      );
    });
  }

  async rememberRemote(
    synchronization: CatalogSynchronization,
    providerResourceId: string,
    providerResourceVersion: string | null | undefined,
    correlationId: string,
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
        {
          status: 'failed',
          reconciliationState: this.dependencies.provider.capabilities().has('catalogIdempotency')
            ? 'pending'
            : 'required',
          providerResourceId,
          providerResourceVersion: providerResourceVersion ?? null,
          lastErrorCode: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
        },
        synchronization.tenantId,
      );
      await recordCatalogSyncTransition(repositories, updated, correlationId);
    });
  }

  private async succeed(
    repositories: Repositories,
    synchronization: CatalogSynchronization,
    providerResourceId: string,
    providerResourceVersion: string | null | undefined,
    correlationId: string,
  ): Promise<void> {
    const synchronizations = repositories.catalogSynchronizations;
    if (!synchronizations) {
      throw this.storageError();
    }
    const succeeded = await synchronizations.update(
      synchronization.resourceType,
      synchronization.resourceId,
      synchronization.provider,
      {
        status: 'succeeded',
        reconciliationState: 'in_sync',
        providerResourceId,
        providerResourceVersion: providerResourceVersion ?? null,
        lastErrorCode: null,
        lastSucceededAt: this.dependencies.clock.now(),
      },
      synchronization.tenantId,
    );
    await recordCatalogSyncTransition(repositories, succeeded, correlationId);
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

interface CatalogProductRemoteReference {
  providerProductId: string;
  providerVersion?: string | null;
}

interface CatalogPriceRemoteReference {
  providerPriceId: string;
  providerVersion?: string | null;
}
