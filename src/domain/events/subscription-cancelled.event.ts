import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface SubscriptionCancelledPayload {
  subscriptionId: string;
  customerId: string;
  endsAt?: Date;
}

export class SubscriptionCancelledEvent extends DomainEvent<SubscriptionCancelledPayload> {
  constructor(payload: SubscriptionCancelledPayload, meta: DomainEventMeta) {
    super('subscription.cancelled', payload, meta.correlationId, meta.occurredAt);
  }
}
