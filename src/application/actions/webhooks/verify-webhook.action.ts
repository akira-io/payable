import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class VerifyWebhookAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('VerifyWebhookAction (Phase 6)');
  }
}
