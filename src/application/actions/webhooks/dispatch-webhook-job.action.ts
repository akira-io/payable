import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class DispatchWebhookJobAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('DispatchWebhookJobAction (Phase 6)');
  }
}
