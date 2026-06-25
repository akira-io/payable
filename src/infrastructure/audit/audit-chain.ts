import type { NewAuditLog } from '../../domain/contracts/audit-log-repository.contract';
import type { AuditLog } from '../../domain/entities/audit-log.entity';
import { hashRequest } from '../../support/hash/request-hash';

export function auditEntryHash(previousHash: string | null, data: NewAuditLog): Promise<string> {
  return hashRequest({
    previousHash,
    tenantId: data.tenantId ?? null,
    correlationId: data.correlationId,
    actorType: data.actorType ?? null,
    actorId: data.actorId ?? null,
    action: data.action,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    before: data.before ?? null,
    after: data.after ?? null,
    metadata: data.metadata ?? null,
  });
}

export async function auditLinkValid(
  previousHash: string | null,
  entry: AuditLog,
): Promise<boolean> {
  if (entry.previousHash !== previousHash) {
    return false;
  }
  return entry.hash === (await auditEntryHash(previousHash, entry));
}
