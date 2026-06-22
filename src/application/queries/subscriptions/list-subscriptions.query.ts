import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class ListSubscriptionsQuery {
  async run(): Promise<never> {
    throw PayableError.notImplemented('ListSubscriptionsQuery (Phase 9)');
  }
}
