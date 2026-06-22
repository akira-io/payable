import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface WebhookReceivedPayload {
  webhookEventId: string;
  provider: string;
  providerEventId: string;
  type: string;
}

export class WebhookReceivedEvent extends DomainEvent<WebhookReceivedPayload> {
  constructor(payload: WebhookReceivedPayload, meta: DomainEventMeta) {
    super('webhook.received', payload, meta.correlationId, meta.occurredAt);
  }
}
