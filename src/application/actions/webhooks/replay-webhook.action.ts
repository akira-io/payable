import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 11
export class ReplayWebhookAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ReplayWebhookAction (Phase 11)');
  }
}
