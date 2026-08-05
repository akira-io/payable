import type { AuditLog } from '../../../../domain/entities/audit-log.entity';
import { PayableError } from '../../../../domain/errors/payable-error';
import type { PrismaAuditLogRow } from '../prisma-client.types';
import { parseJson } from './shared';

export function auditLogToEntity(row: PrismaAuditLogRow): AuditLog {
  const sequence = row.sequence;
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) {
    throw new PayableError('Audit log entry has no valid chain sequence', {
      code: 'AUDIT_SEQUENCE_INVALID',
      context: { auditLogId: row.id },
    });
  }
  return {
    id: row.id,
    sequence,
    tenantId: row.tenantId || null,
    correlationId: row.correlationId,
    actorType: row.actorType ?? null,
    actorId: row.actorId ?? null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    before: parseJson<Record<string, unknown>>(row.before),
    after: parseJson<Record<string, unknown>>(row.after),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    previousHash: row.previousHash ?? null,
    hash: row.hash,
    createdAt: row.createdAt,
  };
}
