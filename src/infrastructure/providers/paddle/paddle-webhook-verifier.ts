import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 13
export class PaddleWebhookVerifier {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('PaddleWebhookVerifier (Phase 13)');
  }
}
