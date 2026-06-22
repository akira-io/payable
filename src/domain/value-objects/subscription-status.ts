export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export function isActiveSubscription(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing';
}

export function isCanceledSubscription(status: SubscriptionStatus): boolean {
  return status === 'canceled';
}
