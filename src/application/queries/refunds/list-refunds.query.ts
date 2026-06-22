import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 10
export class ListRefundsQuery {
  async run(): Promise<never> {
    throw PayableError.notImplemented('ListRefundsQuery (Phase 10)');
  }
}
