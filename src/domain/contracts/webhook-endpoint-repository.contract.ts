import type { WebhookEndpoint, WebhookEndpointStatus } from '../entities/webhook-endpoint.entity';

export interface NewWebhookEndpoint {
  tenantId: string | null;
  url: string;
  events: string[];
  secret: string;
  status: WebhookEndpointStatus;
}

export interface WebhookEndpointRepository {
  create(data: NewWebhookEndpoint): Promise<WebhookEndpoint>;
  findById(id: string, tenantId?: string | null): Promise<WebhookEndpoint | null>;
  list(tenantId?: string | null): Promise<WebhookEndpoint[]>;
  listEnabledForEvent(eventType: string, tenantId?: string | null): Promise<WebhookEndpoint[]>;
  setStatus(
    id: string,
    status: WebhookEndpointStatus,
    tenantId?: string | null,
  ): Promise<WebhookEndpoint>;
}
