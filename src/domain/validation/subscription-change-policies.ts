import type { UpdateSubscriptionInput } from '../dtos/subscription.dto';
import type { SubscriptionChangePolicies } from '../dtos/subscription-change.dto';
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
  return {
    effectiveTiming: input.effectiveTiming,
    prorationPolicy: input.prorationPolicy,
    paymentFailurePolicy: input.paymentFailurePolicy,
    calculatedAt: input.calculatedAt,
  };
}
