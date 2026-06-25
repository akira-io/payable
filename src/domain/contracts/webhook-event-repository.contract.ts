import type { WebhookEvent, WebhookEventStatus } from '../entities/webhook-event.entity';

export type NewWebhookEvent = Omit<WebhookEvent, 'id' | 'processedAt'>;

export interface ClaimOptions {
  replay?: boolean;
}

export interface WebhookEventQuery {
  tenantId?: string | null;
  provider?: string;
  status?: WebhookEventStatus;
  type?: string;
  limit?: number;
}

export interface WebhookEventRepository {
  create(data: NewWebhookEvent): Promise<WebhookEvent>;
  list(query: WebhookEventQuery): Promise<WebhookEvent[]>;
  findById(id: string, tenantId?: string | null): Promise<WebhookEvent | null>;
  findByProviderEvent(
    provider: string,
    providerEventId: string,
    tenantId?: string | null,
  ): Promise<WebhookEvent | null>;
  claim(id: string, tenantId?: string | null, options?: ClaimOptions): Promise<boolean>;
  markStatus(
    id: string,
    status: WebhookEventStatus,
    processedAt: Date | null,
    tenantId?: string | null,
  ): Promise<WebhookEvent>;
}
