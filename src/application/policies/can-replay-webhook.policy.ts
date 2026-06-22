import { PayableError } from '../../domain/errors/payable-error';

// TODO: Phase 11
export class CanReplayWebhookPolicy {
  authorize(): boolean {
    throw PayableError.notImplemented('CanReplayWebhookPolicy (Phase 11)');
  }
}
