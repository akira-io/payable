import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class StripeWebhookVerifier {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('StripeWebhookVerifier (Phase 6)');
  }
}
