import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 2
export class ResolveIdempotencyKeyAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ResolveIdempotencyKeyAction (Phase 2)');
  }
}
