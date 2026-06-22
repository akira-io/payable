import type { NormalizedEventName } from '../../../domain/events/domain-event';

const EVENT_MAP: Record<string, NormalizedEventName> = {
  'customer.created': 'customer.created',
  'customer.updated': 'customer.updated',
  'subscription.created': 'subscription.created',
  'subscription.activated': 'subscription.created',
  'subscription.updated': 'subscription.updated',
  'subscription.canceled': 'subscription.cancelled',
  'subscription.resumed': 'subscription.resumed',
  'transaction.completed': 'payment.succeeded',
  'transaction.paid': 'payment.succeeded',
  'transaction.payment_failed': 'payment.failed',
  'transaction.billed': 'invoice.created',
  'adjustment.created': 'refund.created',
};

export class PaddleEventNormalizer {
  normalize(type: string): NormalizedEventName | null {
    return EVENT_MAP[type] ?? null;
  }
}
