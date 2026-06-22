import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class ReceiveWebhookAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ReceiveWebhookAction (Phase 6)');
  }
}
