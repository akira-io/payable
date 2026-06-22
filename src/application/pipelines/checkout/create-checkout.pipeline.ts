import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 5
export class CreateCheckoutPipeline {
  async process(): Promise<never> {
    throw PayableError.notImplemented('CreateCheckoutPipeline (Phase 5)');
  }
}
