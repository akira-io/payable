import type { ListCatalogInput } from '../../../domain/dtos/catalog.dto';
import { PayableError } from '../../../domain/errors/payable-error';

export function normalizeCatalogListInput<T extends ListCatalogInput>(
  input?: T,
): T & { limit: number; active: boolean } {
  const limit = input?.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new PayableError('Catalog list limit must be an integer between 1 and 100', {
      code: 'VALIDATION_FAILED',
      context: {
        issues: [{ field: 'limit', message: 'Must be an integer between 1 and 100' }],
      },
    });
  }
  return { ...input, limit, active: input?.active ?? true } as T & {
    limit: number;
    active: boolean;
  };
}
