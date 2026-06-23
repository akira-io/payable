import type { WebhookEvent, WebhookEventStatus } from '../entities/webhook-event.entity';

export type NewWebhookEvent = Omit<WebhookEvent, 'id' | 'processedAt'>;

export interface WebhookEventRepository {
  create(data: NewWebhookEvent): Promise<WebhookEvent>;
  findById(id: string): Promise<WebhookEvent | null>;
  findByProviderEvent(
    provider: string,
    providerEventId: string,
    tenantId?: string | null,
  ): Promise<WebhookEvent | null>;
  markStatus(
    id: string,
    status: WebhookEventStatus,
    processedAt: Date | null,
  ): Promise<WebhookEvent>;
}
