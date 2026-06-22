import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 4
export class CreateProductAction {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('CreateProductAction (Phase 4)');
  }
}
