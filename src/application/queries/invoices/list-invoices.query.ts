import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 10
export class ListInvoicesQuery {
  async run(): Promise<never> {
    throw PayableError.notImplemented('ListInvoicesQuery (Phase 10)');
  }
}
