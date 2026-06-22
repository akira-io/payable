import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class CreateSubscriptionAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('CreateSubscriptionAction (Phase 9)');
  }
}
