import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class StripeEventNormalizer {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('StripeEventNormalizer (Phase 6)');
  }
}
