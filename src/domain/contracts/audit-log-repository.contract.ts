import type { AuditLog } from '../entities/audit-log.entity';

export type NewAuditLog = Omit<AuditLog, 'id' | 'sequence' | 'createdAt' | 'hash' | 'previousHash'>;

export interface AuditLogQuery {
  tenantId?: string | null;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  actions?: readonly string[];
  resourceTypes?: readonly string[];
  resourceIds?: readonly string[];
  correlationIds?: readonly string[];
  actorTypes?: readonly string[];
  actorIds?: readonly string[];
  createdAfter?: Date;
  createdBefore?: Date;
  beforeSequence?: number;
  limit?: number;
}

export interface AuditLogRepository {
  create(data: NewAuditLog): Promise<AuditLog>;
  list(query: AuditLogQuery): Promise<AuditLog[]>;
  verifyChain(tenantId: string | null): Promise<boolean>;
  backfillChain(tenantId: string | null): Promise<number>;
}
