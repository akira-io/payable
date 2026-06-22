import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class CreateCustomerAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('CreateCustomerAction (Phase 4)');
  }
}
