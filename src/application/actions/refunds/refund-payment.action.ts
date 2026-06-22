import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 10
export class RefundPaymentAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('RefundPaymentAction (Phase 10)');
  }
}
