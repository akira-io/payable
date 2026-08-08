import type { QueueDriver } from '../../../domain/contracts/queue-driver.contract';
import type {
  CatalogSynchronization,
  CatalogSynchronizationOperation,
} from '../../../domain/entities/catalog-synchronization.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import {
  PROCESS_CATALOG_SYNC_JOB,
  type ProcessCatalogSyncJobPayload,
} from '../../actions/catalog-sync/process-catalog-sync.action';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { deriveCatalogSyncKey, deriveCatalogSyncQueueJobId } from './catalog-sync-idempotency-key';
import { recordCatalogSyncTransition } from './catalog-sync-transitions';

export class CatalogSyncRequester {
  constructor(
    private readonly dependencies: BillingDependencies,
    private readonly queue: QueueDriver,
  ) {}

  async product(productId: string): Promise<CatalogSynchronization> {
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
    const repository = this.repository();
    const existing = await repository.findByResource(
      'product',
      product.id,
      this.dependencies.providerName,
      tenantId,
    );
    const operation = productOperation(Boolean(binding), product.active, existing);
    return this.request({
      resourceType: 'product',
      resourceId: product.id,
      operation,
      canonicalVersion: product.updatedAt.toISOString(),
      providerResourceId: binding?.providerProductId ?? existing?.providerResourceId ?? null,
      existing,
    });
  }

  async price(priceId: string): Promise<CatalogSynchronization> {
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
    const repository = this.repository();
    const existing = await repository.findByResource(
      'price',
      price.id,
      this.dependencies.providerName,
      tenantId,
    );
    const operation = priceOperation(Boolean(binding), price.active, existing);
    return this.request({
      resourceType: 'price',
      resourceId: price.id,
      operation,
      canonicalVersion: price.updatedAt.toISOString(),
      providerResourceId: binding?.providerPriceId ?? existing?.providerResourceId ?? null,
      existing,
    });
  }

  private async request(input: {
    resourceType: 'product' | 'price';
    resourceId: string;
    operation: CatalogSynchronizationOperation;
    canonicalVersion: string;
    providerResourceId: string | null;
    existing: CatalogSynchronization | null;
  }): Promise<CatalogSynchronization> {
    const tenantId = this.dependencies.tenantId ?? null;
    const idempotencyKey = await deriveCatalogSyncKey({
      tenantId,
      provider: this.dependencies.providerName,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      operation: input.operation,
      canonicalVersion: input.canonicalVersion,
    });
    if (input.existing?.reconciliationState === 'required') {
      throw new PayableError('Catalog synchronization requires reconciliation before retrying', {
        code: 'CATALOG_SYNC_RECONCILIATION_REQUIRED',
        context: { resourceType: input.resourceType, resourceId: input.resourceId },
      });
    }
    if (
      input.existing?.idempotencyKey === idempotencyKey &&
      ['requested', 'processing', 'retrying', 'succeeded'].includes(input.existing.status)
    ) {
      return input.existing;
    }
    const correlationId = CorrelationId.generate().toString();
    const requested = await this.storage().transaction(async (repositories) => {
      const synchronizations = repositories.catalogSynchronizations;
      if (!synchronizations) {
        throw this.storageError();
      }
      const saved = await synchronizations.save({
        tenantId,
        provider: this.dependencies.providerName,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        operation: input.operation,
        canonicalVersion: input.canonicalVersion,
        idempotencyKey,
        status: 'requested',
        reconciliationState: 'pending',
        providerResourceId: input.providerResourceId,
        providerResourceVersion: input.existing?.providerResourceVersion ?? null,
        retryCount: input.existing?.retryCount ?? 0,
        lastErrorCode: null,
        lastAttemptedAt: input.existing?.lastAttemptedAt ?? null,
        lastSucceededAt: input.existing?.lastSucceededAt ?? null,
      });
      await recordCatalogSyncTransition(repositories, saved, correlationId);
      return saved;
    });
    const payload: ProcessCatalogSyncJobPayload = {
      providerName: this.dependencies.providerName,
      tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      correlationId,
      canonicalVersion: input.canonicalVersion,
      idempotencyKey,
    };
    await this.queue.dispatch({
      name: PROCESS_CATALOG_SYNC_JOB,
      payload,
      correlationId,
      idempotencyKey: deriveCatalogSyncQueueJobId(idempotencyKey),
    });
    if (!this.queue.inline) {
      return requested;
    }
    return (
      (await this.repository().findByResource(
        input.resourceType,
        input.resourceId,
        this.dependencies.providerName,
        tenantId,
      )) ?? requested
    );
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

function productOperation(
  bound: boolean,
  active: boolean,
  existing: CatalogSynchronization | null,
): CatalogSynchronizationOperation {
  if (!bound || existing?.reconciliationState === 'missing_remote') {
    return 'create';
  }
  if (!active) {
    return 'archive';
  }
  if (existing?.operation === 'archive' && existing.status === 'succeeded') {
    return 'reactivate';
  }
  return 'update';
}

function priceOperation(
  bound: boolean,
  active: boolean,
  existing: CatalogSynchronization | null,
): CatalogSynchronizationOperation {
  if (!bound || existing?.reconciliationState === 'missing_remote') {
    return 'create';
  }
  if (!active) {
    return 'archive';
  }
  if (existing?.operation === 'archive' && existing.status === 'succeeded') {
    return 'reactivate';
  }
  return 'update';
}
