import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface TreasuryWebhookProcessedPayload {
  webhookEventId: string;
  provider: string;
  providerEventId: string;
}

export class TreasuryWebhookProcessedEvent extends DomainEvent<TreasuryWebhookProcessedPayload> {
  constructor(payload: TreasuryWebhookProcessedPayload, meta: DomainEventMeta) {
    super('treasury.webhook.processed', payload, meta.correlationId, meta.occurredAt);
  }
}
