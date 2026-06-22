import type { Money } from '../value-objects/money';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface InvoiceFailedPayload {
  invoiceId: string;
  customerId: string;
  total: Money;
  reason?: string;
}

export class InvoiceFailedEvent extends DomainEvent<InvoiceFailedPayload> {
  constructor(payload: InvoiceFailedPayload, meta: DomainEventMeta) {
    super('invoice.payment_failed', payload, meta.correlationId, meta.occurredAt);
  }
}
