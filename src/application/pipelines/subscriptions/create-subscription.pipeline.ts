import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class CreateSubscriptionPipeline {
  async process(): Promise<never> {
    throw PayableError.notImplemented('CreateSubscriptionPipeline (Phase 9)');
  }
}
