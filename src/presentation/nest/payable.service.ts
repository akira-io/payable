import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 15
export class PayableService {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('PayableService (Phase 15)');
  }
}
