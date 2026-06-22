import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 13
export class PaddleEventNormalizer {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('PaddleEventNormalizer (Phase 13)');
  }
}
