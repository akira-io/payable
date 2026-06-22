import type { SubscriptionStatus } from '../value-objects/subscription-status';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface SubscriptionUpdatedPayload {
  subscriptionId: string;
  customerId: string;
  name: string;
  status: SubscriptionStatus;
}

export class SubscriptionUpdatedEvent extends DomainEvent<SubscriptionUpdatedPayload> {
  constructor(payload: SubscriptionUpdatedPayload, meta: DomainEventMeta) {
    super('subscription.updated', payload, meta.correlationId, meta.occurredAt);
  }
}
