import type {
  WebhookEndpoint,
  WebhookEndpointStatus,
} from '../../../../domain/entities/webhook-endpoint.entity';
import type { PrismaWebhookEndpointRow } from '../prisma-client.types';

function parseEvents(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function webhookEndpointToEntity(
  row: PrismaWebhookEndpointRow,
  secret: string,
): WebhookEndpoint {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    url: row.url,
    events: parseEvents(row.events),
    secret,
    status: row.status as WebhookEndpointStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
