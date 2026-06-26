import type { NewAuditLog } from '../../domain/contracts/audit-log-repository.contract';
import type { AuditLog } from '../../domain/entities/audit-log.entity';
import { canonicalize, hashRequest } from '../../support/hash/request-hash';
import { timingSafeEqual } from '../../support/hash/timing-safe-equal';
import { signWebhookPayload } from '../../support/hash/webhook-signature';

function auditPayload(
  previousHash: string | null,
  sequence: number,
  createdAt: string,
  data: NewAuditLog,
): Record<string, unknown> {
  return {
    previousHash,
    sequence,
    createdAt,
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
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
  };
}

export function auditEntryHash(
  previousHash: string | null,
  sequence: number,
  createdAt: string,
  data: NewAuditLog,
  key?: string,
): Promise<string> {
  const payload = auditPayload(previousHash, sequence, createdAt, data);
  return key ? signWebhookPayload(key, canonicalize(payload)) : hashRequest(payload);
}

export async function auditLinkValid(
  previousHash: string | null,
  sequence: number,
  entry: AuditLog,
  key?: string,
): Promise<boolean> {
  if (entry.previousHash !== previousHash) {
    return false;
  }
  const expected = await auditEntryHash(
    previousHash,
    sequence,
    entry.createdAt.toISOString(),
    entry,
    key,
  );
  return timingSafeEqual(entry.hash, expected);
}
