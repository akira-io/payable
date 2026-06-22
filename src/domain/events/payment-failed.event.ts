import type { Money } from '../value-objects/money';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface PaymentFailedPayload {
  paymentId: string;
  customerId: string;
  amount: Money;
  reason?: string;
}

export class PaymentFailedEvent extends DomainEvent<PaymentFailedPayload> {
  constructor(payload: PaymentFailedPayload, meta: DomainEventMeta) {
    super('payment.failed', payload, meta.correlationId, meta.occurredAt);
  }
}
