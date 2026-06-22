import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class CancelSubscriptionNowAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('CancelSubscriptionNowAction (Phase 9)');
  }
}
