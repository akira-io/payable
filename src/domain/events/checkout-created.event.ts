import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface CheckoutCreatedPayload {
  checkoutId: string;
  customerId: string;
  url: string;
}

export class CheckoutCreatedEvent extends DomainEvent<CheckoutCreatedPayload> {
  constructor(payload: CheckoutCreatedPayload, meta: DomainEventMeta) {
    super('checkout.completed', payload, meta.correlationId, meta.occurredAt);
  }
}
