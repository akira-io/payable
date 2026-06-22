import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 2
export class ExecuteIdempotentOperationAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ExecuteIdempotentOperationAction (Phase 2)');
  }
}
