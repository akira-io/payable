import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { CatalogIdempotencyAction } from '../../../domain/entities/catalog-mutation.entity';
import { CatalogIdempotencyStorageRequiredError } from '../../../domain/errors/catalog-idempotency-storage-required.error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import {
  catalogIdempotencyScope,
  deriveCatalogProviderKey,
  validateCatalogIdempotencyKey,
} from './catalog-idempotency-key';

export interface CatalogIdempotentMutation<T> {
  action: CatalogIdempotencyAction;
  callerKey?: string;
  request: unknown;
  resourceType: 'product' | 'price';
  resourceId?: string;
  run: (context: OperationContext) => Promise<T>;
  revive: (response: unknown) => T;
}

export class CatalogMutationIdempotencyExecutor {
  constructor(private readonly dependencies: BillingDependencies) {}

  async execute<T>(mutation: CatalogIdempotentMutation<T>): Promise<T> {
    const correlationId = CorrelationId.generate().toString();
    if (mutation.callerKey === undefined) {
      return mutation.run({ correlationId, tenantId: this.dependencies.tenantId });
    }

    const callerKey = validateCatalogIdempotencyKey(mutation.callerKey);
    const providerKey = await deriveCatalogProviderKey({
      tenantId: this.dependencies.tenantId,
      providerName: this.dependencies.providerName,
      action: mutation.action,
      callerKey,
    });
    const nativeIdempotency = this.dependencies.provider.capabilities().has('catalogIdempotency');
    const context: OperationContext = nativeIdempotency
      ? { correlationId, tenantId: this.dependencies.tenantId, idempotencyKey: providerKey }
      : { correlationId, tenantId: this.dependencies.tenantId };
    const idempotency = this.dependencies.catalogIdempotency;

    if (!idempotency && nativeIdempotency) {
      return mutation.run(context);
    }
    if (!idempotency) {
      throw new CatalogIdempotencyStorageRequiredError(this.dependencies.providerName);
    }

    return idempotency.execute({
      key: callerKey,
      storageKey: providerKey,
      scope: catalogIdempotencyScope(this.dependencies.providerName, mutation.action),
      operation: `catalog.${mutation.action}`,
      request: mutation.request,
      resourceType: mutation.resourceType,
      resourceId: mutation.resourceId,
      tenantId: this.dependencies.tenantId,
      failurePolicy: nativeIdempotency ? 'default' : 'reconciliation-required',
      correlationId,
      run: () => mutation.run(context),
      revive: mutation.revive,
    });
  }
}
