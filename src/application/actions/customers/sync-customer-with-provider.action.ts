import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class SyncCustomerWithProviderAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('SyncCustomerWithProviderAction (Phase 4)');
  }
}
