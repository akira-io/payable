import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class WriteOutboxEventStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('WriteOutboxEventStep (Phase 6)');
  }
}
