import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class FindSubscriptionQuery {
  async run(): Promise<never> {
    throw PayableError.notImplemented('FindSubscriptionQuery (Phase 9)');
  }
}
