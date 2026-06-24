export type NormalizedEventName =
  | 'customer.created'
  | 'customer.updated'
  | 'checkout.created'
  | 'checkout.completed'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.resumed'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'refund.created'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'webhook.received'
  | 'webhook.processed';

export interface DomainEventMeta {
  correlationId: string;
  occurredAt: Date;
}

export abstract class DomainEvent<P = unknown> {
  constructor(
    readonly name: NormalizedEventName,
    readonly payload: P,
    readonly correlationId: string,
    readonly occurredAt: Date,
  ) {}
}
