import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface SubscriptionResumedPayload {
  subscriptionId: string;
  customerId: string;
}

export class SubscriptionResumedEvent extends DomainEvent<SubscriptionResumedPayload> {
  constructor(payload: SubscriptionResumedPayload, meta: DomainEventMeta) {
    super('subscription.resumed', payload, meta.correlationId, meta.occurredAt);
  }
}
