import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class CreatePriceAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('CreatePriceAction (Phase 4)');
  }
}
