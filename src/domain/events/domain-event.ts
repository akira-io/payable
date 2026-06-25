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
  readonly eventId: string;
  readonly payload: Readonly<P>;

  constructor(
    readonly name: NormalizedEventName,
    payload: P,
    readonly correlationId: string,
    readonly occurredAt: Date,
    readonly version: number = 1,
  ) {
    this.eventId = globalThis.crypto.randomUUID();
    this.payload = Object.freeze(payload) as Readonly<P>;
  }
}
