import type { Money } from '../value-objects/money';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface PaymentLifecyclePayload {
  paymentId: string;
  customerId: string | null;
  amount: Money;
}

export class PaymentAuthorizedEvent extends DomainEvent<PaymentLifecyclePayload> {
  constructor(payload: PaymentLifecyclePayload, meta: DomainEventMeta) {
    super('payment.authorized', payload, meta.correlationId, meta.occurredAt);
  }
}

export class PaymentCapturedEvent extends DomainEvent<PaymentLifecyclePayload> {
  constructor(payload: PaymentLifecyclePayload, meta: DomainEventMeta) {
    super('payment.captured', payload, meta.correlationId, meta.occurredAt);
  }
}

export class PaymentVoidedEvent extends DomainEvent<PaymentLifecyclePayload> {
  constructor(payload: PaymentLifecyclePayload, meta: DomainEventMeta) {
    super('payment.voided', payload, meta.correlationId, meta.occurredAt);
  }
}
