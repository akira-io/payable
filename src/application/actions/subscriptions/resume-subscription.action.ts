import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 9
export class ResumeSubscriptionAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ResumeSubscriptionAction (Phase 9)');
  }
}
