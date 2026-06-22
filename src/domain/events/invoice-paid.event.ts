import type { Money } from '../value-objects/money';
import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface InvoicePaidPayload {
  invoiceId: string;
  customerId: string;
  total: Money;
}

export class InvoicePaidEvent extends DomainEvent<InvoicePaidPayload> {
  constructor(payload: InvoicePaidPayload, meta: DomainEventMeta) {
    super('invoice.paid', payload, meta.correlationId, meta.occurredAt);
  }
}
