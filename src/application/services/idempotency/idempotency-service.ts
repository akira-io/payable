import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 2
export class IdempotencyService {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('IdempotencyService (Phase 2)');
  }
}
