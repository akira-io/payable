import type { QueueDriver } from '../../../domain/contracts/queue-driver.contract';
import type {
  CatalogSynchronization,
  CatalogSynchronizationResourceType,
} from '../../../domain/entities/catalog-synchronization.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import {
  PROCESS_CATALOG_SYNC_JOB,
  type ProcessCatalogSyncJobPayload,
} from '../../actions/catalog-sync/process-catalog-sync.action';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { deriveCatalogSyncQueueJobId } from './catalog-sync-idempotency-key';
import { recordCatalogSyncTransition } from './catalog-sync-transitions';

export class CatalogSyncRetrier {
  constructor(
    private readonly dependencies: BillingDependencies,
    private readonly queue: QueueDriver,
  ) {}

  async product(productId: string): Promise<CatalogSynchronization> {
    return this.retry('product', productId);
  }

  async price(priceId: string): Promise<CatalogSynchronization> {
    return this.retry('price', priceId);
  }

  private async retry(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
  ): Promise<CatalogSynchronization> {
    const tenantId = this.dependencies.tenantId ?? null;
    const repository = this.dependencies.storage?.catalogSynchronizations;
    if (!repository || !this.dependencies.storage) {
      throw this.storageError();
    }
    const existing = await repository.findByResource(
      resourceType,
      resourceId,
      this.dependencies.providerName,
      tenantId,
    );
    if (!existing) {
      throw new PayableError(`Catalog synchronization not found: ${resourceId}`, {
        code: 'CATALOG_SYNC_NOT_FOUND',
        context: { resourceType, resourceId },
      });
    }
    if (existing.reconciliationState === 'required' && !existing.providerResourceId) {
      throw new PayableError('Catalog synchronization requires reconciliation before retry', {
        code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
        context: { resourceType, resourceId },
      });
    }
    if (existing.status === 'processing') {
      throw new PayableError('Catalog synchronization is already in progress', {
        code: 'CATALOG_SYNC_IN_PROGRESS',
        context: { resourceType, resourceId },
      });
    }
    const correlationId = CorrelationId.generate().toString();
    const retrying =
      existing.status === 'retrying'
        ? existing
        : await this.dependencies.storage.transaction(async (repositories) => {
            const synchronizations = repositories.catalogSynchronizations;
            if (!synchronizations) {
              throw this.storageError();
            }
            const updated = await synchronizations.updateIfCurrent(
              resourceType,
              resourceId,
              this.dependencies.providerName,
              existing.canonicalVersion,
              existing.idempotencyKey,
              {
                status: 'retrying',
                reconciliationState: 'pending',
                retryCount: existing.retryCount + 1,
                lastErrorCode: null,
              },
              tenantId,
              undefined,
              ['failed', 'skipped'],
            );
            if (!updated) {
              throw new PayableError('Catalog synchronization is already in progress', {
                code: 'CATALOG_SYNC_IN_PROGRESS',
                context: { resourceType, resourceId },
              });
            }
            await recordCatalogSyncTransition(repositories, updated, correlationId);
            return updated;
          });
    const payload: ProcessCatalogSyncJobPayload = {
      providerName: this.dependencies.providerName,
      tenantId,
      resourceType,
      resourceId,
      correlationId,
      canonicalVersion: retrying.canonicalVersion,
      idempotencyKey: retrying.idempotencyKey,
    };
    await this.queue.dispatch({
      name: PROCESS_CATALOG_SYNC_JOB,
      payload,
      correlationId,
      idempotencyKey: deriveCatalogSyncQueueJobId(existing.idempotencyKey, correlationId),
    });
    if (!this.queue.inline) {
      return retrying;
    }
    return (
      (await repository.findByResource(
        resourceType,
        resourceId,
        this.dependencies.providerName,
        tenantId,
      )) ?? retrying
    );
  }

  private storageError(): PayableError {
    return new PayableError('Catalog synchronization requires compatible storage', {
      code: 'CATALOG_SYNC_STORAGE_REQUIRED',
    });
  }
}
