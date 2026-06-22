import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class ProcessWebhookAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ProcessWebhookAction (Phase 6)');
  }
}
