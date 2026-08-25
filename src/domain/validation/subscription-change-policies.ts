import type { UpdateSubscriptionInput } from '../dtos/subscription.dto';
import type {
  SubscriptionChangePolicies,
  SubscriptionChangeTiming,
} from '../dtos/subscription-change.dto';
import { SubscriptionChangePreviewError } from '../errors/subscription-change-preview.error';

export type RequiredSubscriptionChangePolicies = SubscriptionChangePolicies & {
  calculatedAt: Date;
};

export function requireSubscriptionChangePolicies(
  input: UpdateSubscriptionInput,
): RequiredSubscriptionChangePolicies {
  if (
    input.effectiveTiming === undefined ||
    input.prorationPolicy === undefined ||
    input.paymentFailurePolicy === undefined ||
    input.calculatedAt === undefined
  ) {
    throw new SubscriptionChangePreviewError(
      'Subscription changes require explicit effective timing, proration, payment failure, and calculation time policies',
      'SUBSCRIPTION_CHANGE_POLICY_REQUIRED',
    );
  }
  assertSubscriptionChangeTiming(input);
  const timing: SubscriptionChangeTiming =
    input.effectiveTiming === 'scheduled'
      ? { effectiveTiming: input.effectiveTiming, effectiveAt: input.effectiveAt }
      : { effectiveTiming: input.effectiveTiming };
  return {
    ...timing,
    prorationPolicy: input.prorationPolicy,
    paymentFailurePolicy: input.paymentFailurePolicy,
    calculatedAt: input.calculatedAt,
  };
}

export function assertSubscriptionChangeTiming(input: {
  effectiveTiming?: unknown;
  effectiveAt?: unknown;
}): asserts input is SubscriptionChangeTiming {
  if (input.effectiveTiming === 'scheduled') {
    if (!isValidDate(input.effectiveAt)) {
      throw new SubscriptionChangePreviewError(
        'Scheduled subscription changes require a valid effective date',
        'SUBSCRIPTION_CHANGE_POLICY_REQUIRED',
      );
    }
    return;
  }
  if (
    (input.effectiveTiming !== 'immediate' && input.effectiveTiming !== 'nextRenewal') ||
    input.effectiveAt !== undefined
  ) {
    throw new SubscriptionChangePreviewError(
      'Non-scheduled subscription changes cannot include an effective date',
      'SUBSCRIPTION_CHANGE_POLICY_REQUIRED',
    );
  }
}

export function toSubscriptionChangeTiming(input: {
  effectiveTiming?: unknown;
  effectiveAt?: unknown;
}): SubscriptionChangeTiming {
  assertSubscriptionChangeTiming(input);
  return input.effectiveTiming === 'scheduled'
    ? { effectiveTiming: input.effectiveTiming, effectiveAt: input.effectiveAt }
    : { effectiveTiming: input.effectiveTiming };
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
