import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class NormalizeProviderEventStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('NormalizeProviderEventStep (Phase 6)');
  }
}
