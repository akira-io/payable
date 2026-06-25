import type { WebhookDelivery, WebhookDeliveryStatus } from '../entities/webhook-delivery.entity';

export interface NewWebhookDelivery {
  tenantId: string | null;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseCode: number | null;
  responseBody: string | null;
}

export interface WebhookDeliveryRepository {
  record(data: NewWebhookDelivery): Promise<WebhookDelivery>;
  listForEvent(eventId: string, tenantId?: string | null): Promise<WebhookDelivery[]>;
}
