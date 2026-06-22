import type { Money } from '../value-objects/money';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface PaymentSucceededPayload {
  paymentId: string;
  customerId: string;
  amount: Money;
}

export class PaymentSucceededEvent extends DomainEvent<PaymentSucceededPayload> {
  constructor(payload: PaymentSucceededPayload, meta: DomainEventMeta) {
    super('payment.succeeded', payload, meta.correlationId, meta.occurredAt);
  }
}
