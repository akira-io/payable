import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class CancelSubscriptionAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('CancelSubscriptionAction (Phase 9)');
  }
}
