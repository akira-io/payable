import type {
  WebhookEvent,
  WebhookEventStatus,
} from '../../../../domain/entities/webhook-event.entity';
import type { PrismaWebhookEventRow } from '../prisma-client.types';
import { parseJson } from './shared';

export function webhookEventToEntity(row: PrismaWebhookEventRow): WebhookEvent {
  return {
    id: row.id,
    tenantId: row.tenantId || null,
    provider: row.provider,
    providerEventId: row.providerEventId,
    type: row.type,
    normalizedType: row.normalizedType ?? null,
    payload: row.payload,
    signature: row.signature ?? null,
    data: parseJson<Record<string, unknown>>(row.data) ?? {},
    headers: parseJson<Record<string, string>>(row.headers) ?? {},
    status: row.status as WebhookEventStatus,
    correlationId: row.correlationId,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? null,
  };
}
