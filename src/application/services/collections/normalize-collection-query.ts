import { PayableError } from '../../../domain/errors/payable-error';

export const DEFAULT_COLLECTION_LIMIT = 25;
export const MAX_COLLECTION_LIMIT = 100;

export function normalizeCollectionLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_COLLECTION_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COLLECTION_LIMIT) {
    throw new PayableError('Collection limit must be an integer between 1 and 100', {
      code: 'COLLECTION_LIMIT_INVALID',
      context: { limit },
    });
  }
  return limit;
}
