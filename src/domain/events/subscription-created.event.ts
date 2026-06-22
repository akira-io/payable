import type { SubscriptionStatus } from '../value-objects/subscription-status';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface SubscriptionCreatedPayload {
  subscriptionId: string;
  customerId: string;
  name: string;
  status: SubscriptionStatus;
}

export class SubscriptionCreatedEvent extends DomainEvent<SubscriptionCreatedPayload> {
  constructor(payload: SubscriptionCreatedPayload, meta: DomainEventMeta) {
    super('subscription.created', payload, meta.correlationId, meta.occurredAt);
  }
}
