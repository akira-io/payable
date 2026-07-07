import type { SubscriptionDTO } from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import type { SubscriptionStatus } from '../../../domain/value-objects/subscription-status';

const STATUS_BY_EVENT: Record<string, SubscriptionStatus> = {
  SUBSCRIPTION_INITIATED: 'incomplete',
  SUBSCRIPTION_FINISHED: 'canceled',
  SUBSCRIPTION_CANCELLED: 'canceled',
  SUBSCRIPTION_OVERDUE: 'past_due',
};

export function reconcileRevolutSubscriptionWebhook(
  verified: VerifiedWebhook,
): SubscriptionDTO | null {
  const event = typeof verified.data.event === 'string' ? verified.data.event : verified.type;
  const subscriptionId =
    typeof verified.data.subscription_id === 'string' ? verified.data.subscription_id : null;
  const status = STATUS_BY_EVENT[event];
  if (!subscriptionId || !status) {
    return null;
  }
  return {
    providerSubscriptionId: subscriptionId,
    status,
    currentPeriodEnd: null,
    trialEndsAt: null,
  };
}
