export type NormalizedEventName =
  | 'customer.created'
  | 'customer.updated'
  | 'checkout.created'
  | 'checkout.completed'
  | 'payment.succeeded'
  | 'payment.authorized'
  | 'payment.captured'
  | 'payment.voided'
  | 'payment.failed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.resumed'
  | 'subscription.price_migration.scheduled'
  | 'subscription.price_migration.executing'
  | 'subscription.price_migration.applied'
  | 'subscription.price_migration.failed'
  | 'subscription.price_migration.reconciliation_required'
  | 'subscription.price_migration.pending_renewal'
  | 'subscription.price_migration.cancelled'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'refund.created'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'treasury.webhook.processed'
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
