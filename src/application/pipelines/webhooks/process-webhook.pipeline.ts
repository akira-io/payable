import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 6
export class ProcessWebhookPipeline {
  async process(): Promise<never> {
    throw PayableError.notImplemented('ProcessWebhookPipeline (Phase 6)');
  }
}
