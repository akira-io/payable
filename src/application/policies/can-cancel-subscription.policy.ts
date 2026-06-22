import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 6
export class CanCancelSubscriptionPolicy {
  authorize(): boolean {
    throw PayableError.notImplemented('CanCancelSubscriptionPolicy (Phase 6)');
  }
}
