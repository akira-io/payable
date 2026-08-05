import type {
  AuditLogQuery,
  AuditLogRepository,
} from '../../domain/contracts/audit-log-repository.contract';
import type { AuditLog, SequencedAuditLog } from '../../domain/entities/audit-log.entity';
import { PayableError } from '../../domain/errors/payable-error';
import { type AuditEntryInput, AuditService } from '../../infrastructure/audit/audit-service';
import { decodeAuditCursor, encodeAuditCursor } from '../services/audit/audit-cursor';
import { normalizeAuditPageQuery, validateAuditRecord } from '../services/audit/audit-validation';

export type AuditRecordInput = Omit<AuditEntryInput, 'tenantId'>;

export interface AuditPageQuery {
  actions?: readonly string[];
  resourceTypes?: readonly string[];
  resourceIds?: readonly string[];
  correlationIds?: readonly string[];
  actorTypes?: readonly string[];
  actorIds?: readonly string[];
  createdAfter?: Date;
  createdBefore?: Date;
  cursor?: string;
  limit?: number;
}

export interface AuditPage {
  data: SequencedAuditLog[];
  nextCursor: string | null;
}

export class AuditResource {
  constructor(
    private readonly repository: AuditLogRepository,
    private readonly tenantId: string | null,
  ) {}

  async record(input: AuditRecordInput): Promise<AuditLog> {
    return new AuditService(this.repository).record({
      ...validateAuditRecord(input),
      tenantId: this.tenantId,
    });
  }

  async list(query: AuditPageQuery = {}): Promise<AuditPage> {
    const normalized = normalizeAuditPageQuery(query);
    const repositoryQuery: AuditLogQuery = {
      tenantId: this.tenantId,
      actions: normalized.actions,
      resourceTypes: normalized.resourceTypes,
      resourceIds: normalized.resourceIds,
      correlationIds: normalized.correlationIds,
      actorTypes: normalized.actorTypes,
      actorIds: normalized.actorIds,
      createdAfter: normalized.createdAfter,
      createdBefore: normalized.createdBefore,
      beforeSequence: normalized.cursor ? decodeAuditCursor(normalized.cursor) : undefined,
      limit: normalized.limit + 1,
    };
    const rows = await this.repository.list(repositoryQuery);
    const data = rows.slice(0, normalized.limit).map((auditLog) => requireAuditSequence(auditLog));
    const last = data.at(-1);
    return {
      data,
      nextCursor: rows.length > normalized.limit && last ? encodeAuditCursor(last.sequence) : null,
    };
  }

  verify(): Promise<boolean> {
    return this.repository.verifyChain(this.tenantId);
  }
}

function requireAuditSequence(auditLog: AuditLog): SequencedAuditLog {
  const sequence = auditLog.sequence;
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) {
    throw new PayableError('Audit log entry has no valid chain sequence', {
      code: 'AUDIT_SEQUENCE_INVALID',
      context: { auditLogId: auditLog.id },
    });
  }
  return { ...auditLog, sequence };
}
