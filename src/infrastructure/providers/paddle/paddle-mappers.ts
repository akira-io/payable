import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 13
export class PaddleMappers {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('PaddleMappers (Phase 13)');
  }
}
