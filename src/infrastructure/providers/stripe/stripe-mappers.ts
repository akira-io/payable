import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class StripeMappers {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('StripeMappers (Phase 4)');
  }
}
