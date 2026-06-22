import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class StoreWebhookEventAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('StoreWebhookEventAction (Phase 6)');
  }
}
