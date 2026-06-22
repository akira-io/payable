import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class SyncProductWithProviderAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('SyncProductWithProviderAction (Phase 4)');
  }
}
