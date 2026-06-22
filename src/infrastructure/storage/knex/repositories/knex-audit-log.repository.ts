import type { AuditLogRepository } from '../../../../domain/contracts/audit-log-repository.contract';
import type { AuditLog } from '../../../../domain/entities/audit-log.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexAuditLogRepository implements AuditLogRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<AuditLog> {
    return this.unsupported('create');
  }

  list(): Promise<AuditLog[]> {
    return this.unsupported('list');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexAuditLogRepository.${op} (Phase 3)`);
  }
}
