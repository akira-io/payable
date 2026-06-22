import type { Money } from '../value-objects/money';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface RefundCreatedPayload {
  refundId: string;
  paymentId: string;
  amount: Money;
}

export class RefundCreatedEvent extends DomainEvent<RefundCreatedPayload> {
  constructor(payload: RefundCreatedPayload, meta: DomainEventMeta) {
    super('refund.created', payload, meta.correlationId, meta.occurredAt);
  }
}
