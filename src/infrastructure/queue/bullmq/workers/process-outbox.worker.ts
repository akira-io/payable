import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 11
export class ProcessOutboxWorker {
  register(): void {
    throw PayableError.notImplemented('ProcessOutboxWorker (Phase 11)');
  }
}
