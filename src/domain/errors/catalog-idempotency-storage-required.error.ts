import { PayableError } from './payable-error';

export class CatalogIdempotencyStorageRequiredError extends PayableError {
  constructor(provider: string) {
    super(`Catalog idempotency requires a storage driver for ${provider}`, {
      code: 'CATALOG_IDEMPOTENCY_STORAGE_REQUIRED',
      context: { provider },
    });
  }
}
