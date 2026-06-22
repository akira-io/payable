import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 6
export class CanResumeSubscriptionPolicy {
  authorize(): boolean {
    throw PayableError.notImplemented('CanResumeSubscriptionPolicy (Phase 6)');
  }
}
