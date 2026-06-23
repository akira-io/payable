import type { Logger } from '../../../domain/contracts/logger.contract';
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
  constructor(private readonly logger?: Logger) {}

  normalize(type: string): NormalizedEventName | null {
    const normalized = EVENT_MAP[type] ?? null;
    if (normalized === null) {
      this.logger?.warn('Unmapped Paddle event type', { provider: 'paddle', type });
    }
    return normalized;
  }
}
