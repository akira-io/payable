import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 6
export class CanCreateCheckoutPolicy {
  authorize(): boolean {
    throw PayableError.notImplemented('CanCreateCheckoutPolicy (Phase 6)');
  }
}
