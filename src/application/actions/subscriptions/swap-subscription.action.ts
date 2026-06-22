import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class SwapSubscriptionAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('SwapSubscriptionAction (Phase 9)');
  }
}
