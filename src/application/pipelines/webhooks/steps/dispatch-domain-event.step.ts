import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class DispatchDomainEventStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('DispatchDomainEventStep (Phase 6)');
  }
}
