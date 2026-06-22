import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 3
export class FindCustomerQuery {
  async run(): Promise<never> {
    throw PayableError.notImplemented('FindCustomerQuery (Phase 3)');
  }
}
