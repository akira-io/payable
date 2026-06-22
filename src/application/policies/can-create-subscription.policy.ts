import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 6
export class CanCreateSubscriptionPolicy {
  authorize(): boolean {
    throw PayableError.notImplemented('CanCreateSubscriptionPolicy (Phase 6)');
  }
}
