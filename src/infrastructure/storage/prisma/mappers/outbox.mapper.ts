import type {
  OutboxEvent,
  OutboxStatus,
} from '../../../../domain/contracts/outbox-event-repository.contract';
import type { PrismaOutboxEventRow } from '../prisma-client.types';
import { parseJson } from './shared';

export function outboxToEntity(row: PrismaOutboxEventRow): OutboxEvent {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    correlationId: row.correlationId,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    nextRetryAt: row.nextRetryAt ?? null,
    lockToken: row.lockedBy ?? null,
    dedupeKey: row.dedupeKey ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
