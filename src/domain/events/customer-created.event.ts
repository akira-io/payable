import { DomainEvent, type DomainEventMeta } from './domain-event';

export interface CustomerCreatedPayload {
  customerId: string;
  billableType: string;
  billableId: string;
}

export class CustomerCreatedEvent extends DomainEvent<CustomerCreatedPayload> {
  constructor(payload: CustomerCreatedPayload, meta: DomainEventMeta) {
    super('customer.created', payload, meta.correlationId, meta.occurredAt);
  }
}
