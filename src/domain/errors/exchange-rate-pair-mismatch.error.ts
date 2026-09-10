import { PayableError, type PayableErrorOptions } from './payable-error';

export class ExchangeRatePairMismatchError extends PayableError {
  constructor(
    expectedFrom: string,
    expectedTo: string,
    actualFrom: string,
    actualTo: string,
    options: PayableErrorOptions = {},
  ) {
    super(
      `Exchange rate provider returned a rate for ${actualFrom}/${actualTo} when ${expectedFrom}/${expectedTo} was requested`,
      {
        ...options,
        code: 'EXCHANGE_RATE_PAIR_MISMATCH',
        context: { expectedFrom, expectedTo, actualFrom, actualTo, ...options.context },
      },
    );
  }
}
