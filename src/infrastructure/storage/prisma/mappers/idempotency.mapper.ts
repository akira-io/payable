import type {
  IdempotencyRecord,
  IdempotencyStatus,
} from '../../../../domain/contracts/idempotency-store.contract';
import type { PrismaIdempotencyKeyRow } from '../prisma-client.types';
import { parseJson } from './shared';

export function idempotencyToRecord(row: PrismaIdempotencyKeyRow): IdempotencyRecord {
  return {
    key: row.key,
    scope: row.scope,
    operation: row.operation,
    resourceType: row.resourceType ?? null,
    resourceId: row.resourceId ?? null,
    requestHash: row.requestHash,
    response: parseJson(row.response),
    status: row.status as IdempotencyStatus,
    lockedUntil: row.lockedUntil ?? null,
    expiresAt: row.expiresAt ?? null,
    lockToken: row.lockToken ?? null,
  };
}
