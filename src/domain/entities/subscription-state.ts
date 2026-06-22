import type { Subscription } from './subscription.entity';

export function onTrial(subscription: Subscription, now: Date): boolean {
  return subscription.trialEndsAt !== null && subscription.trialEndsAt.getTime() > now.getTime();
}

export function onGracePeriod(subscription: Subscription, now: Date): boolean {
  return subscription.endsAt !== null && subscription.endsAt.getTime() > now.getTime();
}

export function subscriptionEnded(subscription: Subscription, now: Date): boolean {
  return subscription.endsAt !== null && subscription.endsAt.getTime() <= now.getTime();
}
