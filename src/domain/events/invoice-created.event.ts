import type { Money } from '../value-objects/money';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface InvoiceCreatedPayload {
  invoiceId: string;
  customerId: string;
  total: Money;
}

export class InvoiceCreatedEvent extends DomainEvent<InvoiceCreatedPayload> {
  constructor(payload: InvoiceCreatedPayload, meta: DomainEventMeta) {
    super('invoice.created', payload, meta.correlationId, meta.occurredAt);
  }
}
