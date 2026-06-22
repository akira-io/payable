import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class CancelSubscriptionPipeline {
  async process(): Promise<never> {
    throw PayableError.notImplemented('CancelSubscriptionPipeline (Phase 9)');
  }
}
