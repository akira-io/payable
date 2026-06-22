import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 10
export class ListInvoicesAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ListInvoicesAction (Phase 10)');
  }
}
