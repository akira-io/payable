import type { WebhookEvent, WebhookEventStatus } from '../entities/webhook-event.entity';

export type NewWebhookEvent = Omit<WebhookEvent, 'id' | 'processedAt'>;

export interface WebhookEventRepository {
  create(data: NewWebhookEvent): Promise<WebhookEvent>;
  findById(id: string, tenantId?: string | null): Promise<WebhookEvent | null>;
  findByProviderEvent(
    provider: string,
    providerEventId: string,
    tenantId?: string | null,
  ): Promise<WebhookEvent | null>;
  claim(id: string, tenantId?: string | null): Promise<boolean>;
  markStatus(
    id: string,
    status: WebhookEventStatus,
    processedAt: Date | null,
  ): Promise<WebhookEvent>;
}
