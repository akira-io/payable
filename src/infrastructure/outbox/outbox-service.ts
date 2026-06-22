import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 11
export class OutboxService {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('OutboxService (Phase 11)');
  }
}
