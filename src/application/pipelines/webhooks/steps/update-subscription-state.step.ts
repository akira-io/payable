import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class UpdateSubscriptionStateStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('UpdateSubscriptionStateStep (Phase 6)');
  }
}
