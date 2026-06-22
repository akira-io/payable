import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 2
export class AuditService {
  async handle(): Promise<never> {
    throw PayableError.notImplemented('AuditService (Phase 2)');
  }
}
