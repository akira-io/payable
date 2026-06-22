import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class UpdateSubscriptionQuantityAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('UpdateSubscriptionQuantityAction (Phase 9)');
  }
}
