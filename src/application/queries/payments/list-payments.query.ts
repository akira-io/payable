import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 10
export class ListPaymentsQuery {
  async run(): Promise<never> {
    throw PayableError.notImplemented('ListPaymentsQuery (Phase 10)');
  }
}
