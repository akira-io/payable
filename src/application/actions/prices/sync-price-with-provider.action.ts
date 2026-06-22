import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class SyncPriceWithProviderAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('SyncPriceWithProviderAction (Phase 4)');
  }
}
