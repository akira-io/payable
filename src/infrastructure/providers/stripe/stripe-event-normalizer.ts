import type { NormalizedEventName } from '../../../domain/events/domain-event';

const EVENT_MAP: Record<string, NormalizedEventName> = {
  'checkout.session.completed': 'checkout.completed',
  'payment_intent.succeeded': 'payment.succeeded',
  'payment_intent.payment_failed': 'payment.failed',
  'customer.created': 'customer.created',
  'customer.updated': 'customer.updated',
  'customer.subscription.created': 'subscription.created',
  'customer.subscription.updated': 'subscription.updated',
  'customer.subscription.deleted': 'subscription.cancelled',
  'customer.subscription.resumed': 'subscription.resumed',
  'invoice.created': 'invoice.created',
  'invoice.paid': 'invoice.paid',
  'invoice.payment_failed': 'invoice.payment_failed',
  'charge.refunded': 'refund.succeeded',
  'refund.created': 'refund.created',
  'refund.failed': 'refund.failed',
};

export class StripeEventNormalizer {
  normalize(type: string): NormalizedEventName | null {
    return EVENT_MAP[type] ?? null;
  }
}
