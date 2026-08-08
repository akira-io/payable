import type { Subscription } from '../../../domain/entities/subscription.entity';
import { PayableError } from '../../../domain/errors/payable-error';

export type CanonicalSubscriptionActivation =
  | { state: 'pending' }
  | { state: 'active'; startsAt: Date }
  | { state: 'trialing'; startsAt: Date; trialEndsAt: Date };

export function resolveInitialCanonicalSubscriptionLifecycle(
  activation: CanonicalSubscriptionActivation,
  interval: 'day' | 'week' | 'month' | 'year',
  intervalCount: number,
): Pick<Subscription, 'status' | 'trialEndsAt' | 'currentPeriodStart' | 'currentPeriodEnd'> {
  if (activation.state === 'pending') {
    return {
      status: 'incomplete',
      trialEndsAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
  }
  const startsAt = validDate(activation.startsAt, 'startsAt');
  if (activation.state === 'trialing') {
    const trialEndsAt = validDate(activation.trialEndsAt, 'trialEndsAt');
    if (trialEndsAt.getTime() <= startsAt.getTime()) {
      throw new PayableError('Trial end must be after the subscription start', {
        code: 'SUBSCRIPTION_TRIAL_INVALID',
      });
    }
    return {
      status: 'trialing',
      trialEndsAt,
      currentPeriodStart: startsAt,
      currentPeriodEnd: trialEndsAt,
    };
  }
  return {
    status: 'active',
    trialEndsAt: null,
    currentPeriodStart: startsAt,
    currentPeriodEnd: addRecurringInterval(startsAt, interval, intervalCount),
  };
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PayableError(`Subscription ${field} must be a valid date`, {
      code: 'SUBSCRIPTION_DATE_INVALID',
      context: { field },
    });
  }
  return new Date(value.getTime());
}

function addRecurringInterval(
  startsAt: Date,
  interval: 'day' | 'week' | 'month' | 'year',
  intervalCount: number,
): Date {
  const renewalBoundary = new Date(startsAt.getTime());
  if (interval === 'day' || interval === 'week') {
    renewalBoundary.setUTCDate(
      renewalBoundary.getUTCDate() + intervalCount * (interval === 'week' ? 7 : 1),
    );
    return renewalBoundary;
  }
  const originalDay = renewalBoundary.getUTCDate();
  renewalBoundary.setUTCDate(1);
  if (interval === 'month') {
    renewalBoundary.setUTCMonth(renewalBoundary.getUTCMonth() + intervalCount);
  } else {
    renewalBoundary.setUTCFullYear(renewalBoundary.getUTCFullYear() + intervalCount);
  }
  const lastDay = new Date(
    Date.UTC(renewalBoundary.getUTCFullYear(), renewalBoundary.getUTCMonth() + 1, 0),
  ).getUTCDate();
  renewalBoundary.setUTCDate(Math.min(originalDay, lastDay));
  return renewalBoundary;
}
