import type { Logger } from '../../../domain/contracts/logger.contract';
import type { NormalizedEventName } from '../../../domain/events/domain-event';

const EVENT_MAP: Record<string, NormalizedEventName> = {
  ORDER_COMPLETED: 'payment.succeeded',
  ORDER_FAILED: 'payment.failed',
  ORDER_PAYMENT_DECLINED: 'payment.failed',
  ORDER_PAYMENT_FAILED: 'payment.failed',
  SUBSCRIPTION_INITIATED: 'subscription.created',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  SUBSCRIPTION_FINISHED: 'subscription.cancelled',
  SUBSCRIPTION_OVERDUE: 'invoice.payment_failed',
};

export class RevolutEventNormalizer {
  constructor(private readonly logger?: Logger) {}

  normalize(type: string): NormalizedEventName | null {
    const normalized = EVENT_MAP[type] ?? null;
    if (normalized === null) {
      this.logger?.warn('Unmapped Revolut event type', { provider: 'revolut', type });
    }
    return normalized;
  }
}
