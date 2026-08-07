import { PayableError } from '../errors/payable-error';
import type {
  SubscriptionEffectiveTiming,
  SubscriptionPaymentCollectionBehavior,
  SubscriptionResumeBillingPolicy,
} from './subscription-operation-capabilities.dto';

export interface PauseSubscriptionPolicy {
  effectiveTiming: Extract<SubscriptionEffectiveTiming, 'immediate' | 'nextRenewal'>;
  resumeAt: Date | null;
  resumeBillingPolicy: SubscriptionResumeBillingPolicy;
}

export type ResumePausedSubscriptionPolicy =
  | {
      effectiveTiming: 'immediate';
      billingPolicy: SubscriptionResumeBillingPolicy;
    }
  | {
      effectiveTiming: 'scheduled';
      effectiveAt: Date;
      billingPolicy: SubscriptionResumeBillingPolicy;
    };

export interface PausePaymentCollectionPolicy {
  behavior: SubscriptionPaymentCollectionBehavior;
  resumesAt: Date | null;
}

const PAYMENT_COLLECTION_BEHAVIORS: readonly SubscriptionPaymentCollectionBehavior[] = [
  'keepAsDraft',
  'markUncollectible',
  'void',
];

function isFutureDate(value: unknown, now: Date): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() > now.getTime();
}

export function validatePauseSubscriptionPolicy(policy: PauseSubscriptionPolicy, now: Date): void {
  if (policy.resumeAt !== null && !isFutureDate(policy.resumeAt, now)) {
    throw new PayableError('Subscription pause resume date must be a valid future date', {
      code: 'SUBSCRIPTION_PAUSE_POLICY_INVALID',
      context: { field: 'resumeAt' },
    });
  }
}

export function validatePauseSubscriptionResumeBoundary(
  policy: PauseSubscriptionPolicy,
  currentPeriodEnd: Date | null,
): void {
  if (
    policy.effectiveTiming === 'nextRenewal' &&
    policy.resumeAt !== null &&
    currentPeriodEnd !== null &&
    policy.resumeAt.getTime() <= currentPeriodEnd.getTime()
  ) {
    throw new PayableError('Subscription cannot resume before its scheduled pause takes effect', {
      code: 'SUBSCRIPTION_PAUSE_POLICY_INVALID',
      context: { field: 'resumeAt' },
    });
  }
}

export function validateResumePausedSubscriptionPolicy(
  policy: ResumePausedSubscriptionPolicy,
  now: Date,
): void {
  if (policy.effectiveTiming === 'scheduled' && !isFutureDate(policy.effectiveAt, now)) {
    throw new PayableError('Subscription resume effective date must be a valid future date', {
      code: 'SUBSCRIPTION_RESUME_POLICY_INVALID',
      context: { field: 'effectiveAt' },
    });
  }
}

export function validatePausePaymentCollectionPolicy(
  policy: PausePaymentCollectionPolicy,
  now: Date,
): void {
  if (!PAYMENT_COLLECTION_BEHAVIORS.includes(policy.behavior)) {
    throw new PayableError('Subscription payment collection behavior is invalid', {
      code: 'SUBSCRIPTION_PAYMENT_COLLECTION_POLICY_INVALID',
      context: { field: 'behavior' },
    });
  }
  if (policy.resumesAt !== null && !isFutureDate(policy.resumesAt, now)) {
    throw new PayableError('Payment collection resume date must be a valid future date', {
      code: 'SUBSCRIPTION_PAYMENT_COLLECTION_POLICY_INVALID',
      context: { field: 'resumesAt' },
    });
  }
}
