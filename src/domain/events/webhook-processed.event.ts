import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface WebhookProcessedPayload {
  webhookEventId: string;
  provider: string;
  providerEventId: string;
}

export class WebhookProcessedEvent extends DomainEvent<WebhookProcessedPayload> {
  constructor(payload: WebhookProcessedPayload, meta: DomainEventMeta) {
    super('webhook.processed', payload, meta.correlationId, meta.occurredAt);
  }
}
