import type {
  AuditLogRepository,
  NewAuditLog,
} from '../../domain/contracts/audit-log-repository.contract';
import type { AuditLog } from '../../domain/entities/audit-log.entity';

export interface AuditEntryInput {
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
  actorType?: string | null;
  actorId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  tenantId?: string | null;
}

export class AuditService {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(input: AuditEntryInput): Promise<AuditLog> {
    return this.repository.create(this.toRecord(input));
  }

  async verify(tenantId: string | null = null): Promise<boolean> {
    return this.repository.verifyChain(tenantId);
  }

  private toRecord(input: AuditEntryInput): NewAuditLog {
    return {
      tenantId: input.tenantId ?? null,
      correlationId: input.correlationId,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.metadata ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
  }
}
