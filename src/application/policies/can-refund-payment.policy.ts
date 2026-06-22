import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 6
export class CanRefundPaymentPolicy {
  authorize(): boolean {
    throw PayableError.notImplemented('CanRefundPaymentPolicy (Phase 6)');
  }
}
