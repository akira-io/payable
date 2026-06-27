import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from '../../../../domain/entities/webhook-delivery.entity';
import type { PrismaWebhookDeliveryRow } from '../prisma-client.types';
import { parseJson } from './shared';

export function webhookDeliveryToEntity(row: PrismaWebhookDeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    endpointId: row.endpointId,
    eventId: (row.eventId ?? '') as string,
    eventType: row.eventType,
    payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    responseCode: row.responseCode ?? null,
    responseBody: row.responseBody ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
