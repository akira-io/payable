import type { AuditLog } from '../entities/audit-log.entity';

export type NewAuditLog = Omit<AuditLog, 'id' | 'createdAt'>;

export interface AuditLogQuery {
  tenantId?: string | null;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  limit?: number;
}

export interface AuditLogRepository {
  create(data: NewAuditLog): Promise<AuditLog>;
  list(query: AuditLogQuery): Promise<AuditLog[]>;
}
