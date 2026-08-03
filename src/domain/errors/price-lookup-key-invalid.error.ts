import { PayableError } from './payable-error';

export class PriceLookupKeyInvalidError extends PayableError {
  constructor(field: string, reason: string, maximum?: number) {
    super(`Invalid price lookup key ${field}: ${reason}`, {
      code: 'PRICE_LOOKUP_KEY_INVALID',
      context: { field, reason, ...(maximum === undefined ? {} : { maximum }) },
    });
  }
}
