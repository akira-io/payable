import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 6
export class WriteAuditLogStep {
  async handle(): Promise<unknown> {
    throw PayableError.notImplemented('WriteAuditLogStep (Phase 6)');
  }
}
