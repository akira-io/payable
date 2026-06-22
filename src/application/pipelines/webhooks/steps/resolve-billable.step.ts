import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class ResolveBillableStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('ResolveBillableStep (Phase 6)');
  }
}
