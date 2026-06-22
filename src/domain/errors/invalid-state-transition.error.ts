import { PayableError, type PayableErrorOptions } from './payable-error';

export class InvalidStateTransitionError extends PayableError {
  constructor(
    machine: string,
    from: string,
    transition: string,
    options: PayableErrorOptions = {},
  ) {
    super(`Invalid ${machine} transition '${transition}' from state '${from}'`, {
      ...options,
      code: 'INVALID_STATE_TRANSITION',
      context: { machine, from, transition, ...options.context },
    });
  }
}
