import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class UpdatePaymentStateStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('UpdatePaymentStateStep (Phase 6)');
  }
}
