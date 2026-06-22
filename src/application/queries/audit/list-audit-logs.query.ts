import { PayableError } from '../../../domain/errors/payable-error';

// TODO: Phase 2
export class ListAuditLogsQuery {
  async run(): Promise<never> {
    throw PayableError.notImplemented('ListAuditLogsQuery (Phase 2)');
  }
}
