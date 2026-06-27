import type { AuditLog } from '../../../../domain/entities/audit-log.entity';
import type { PrismaAuditLogRow } from '../prisma-client.types';
import { parseJson } from './shared';

export function auditLogToEntity(row: PrismaAuditLogRow): AuditLog {
  return {
    id: row.id,
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
