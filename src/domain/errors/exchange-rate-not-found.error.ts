import { PayableError, type PayableErrorOptions } from './payable-error';

export class ExchangeRateNotFoundError extends PayableError {
  constructor(from: string, to: string, options: PayableErrorOptions = {}) {
    super(`Exchange rate not found for ${from} to ${to}`, {
      ...options,
      code: 'EXCHANGE_RATE_NOT_FOUND',
      context: { from, to, ...options.context },
    });
  }
}
