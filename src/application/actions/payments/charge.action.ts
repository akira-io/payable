import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 10
export class ChargeAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('ChargeAction (Phase 10)');
  }
}
