import type { CatalogPersistenceAction } from '../entities/catalog-mutation.entity';
import { PayableError, type PayableErrorOptions } from './payable-error';

export type CatalogPersistenceResource = 'product' | 'price';

export interface CatalogPersistenceFailure {
  resourceType: CatalogPersistenceResource;
  action: CatalogPersistenceAction;
  provider: string;
  providerResourceId: string;
  tenantId: string | null;
  correlationId: string;
}

export class CatalogPersistenceError extends PayableError {
  constructor(failure: CatalogPersistenceFailure, options: PayableErrorOptions = {}) {
    super(
      `Failed to persist ${failure.resourceType} after ${failure.provider} confirmed ${failure.action}`,
      {
        ...options,
        code: 'CATALOG_PERSISTENCE_FAILED',
        correlationId: failure.correlationId,
        context: { ...failure, ...options.context },
      },
    );
  }
}
