import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class CreateCheckoutSessionAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('CreateCheckoutSessionAction (Phase 4)');
  }
}
