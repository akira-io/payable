import type {
  AuditLogQuery,
  AuditLogRepository,
} from '../../../domain/contracts/audit-log-repository.contract';
import type { AuditLog } from '../../../domain/entities/audit-log.entity';

export class ListAuditLogsQuery {
  constructor(
    private readonly repository: AuditLogRepository,
    private readonly tenantId: string | null = null,
  ) {}

  async run(query: AuditLogQuery = {}): Promise<AuditLog[]> {
    return this.repository.list({ ...query, tenantId: this.tenantId });
  }
}
