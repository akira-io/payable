import type { PaymentProvider } from '../../../domain/contracts/payment-provider.contract';
import {
  isSubscriptionChangeOutcomeCapable,
  type SubscriptionChangeApplicationOutcome,
  type SubscriptionChangeCapable,
} from '../../../domain/contracts/subscription-change-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { ProviderSubscriptionChangeInput } from '../../../domain/dtos/subscription-change.dto';
import { isSubscriptionStatus } from '../../../domain/value-objects/subscription-status';

export async function applySubscriptionPriceMigrationProvider(
  provider: PaymentProvider & SubscriptionChangeCapable,
  input: ProviderSubscriptionChangeInput,
  context: OperationContext,
): Promise<SubscriptionChangeApplicationOutcome> {
  const outcome: unknown = isSubscriptionChangeOutcomeCapable(provider)
    ? await provider.applySubscriptionChangeWithOutcome(input, context)
    : {
        kind: 'applied',
        subscription: await provider.applySubscriptionChange(input, context),
      };
  if (!isSubscriptionChangeApplicationOutcome(outcome)) {
    throw new TypeError('Provider returned an invalid subscription change outcome');
  }
  return outcome;
}

function isSubscriptionChangeApplicationOutcome(
  value: unknown,
): value is SubscriptionChangeApplicationOutcome {
  if (!value || typeof value !== 'object') return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === 'not_applied') {
    return (
      outcome.sideEffects === 'definitively_none' &&
      typeof outcome.code === 'string' &&
      outcome.code.trim().length > 0 &&
      (outcome.message === undefined || typeof outcome.message === 'string')
    );
  }
  if (outcome.kind !== 'applied' || !outcome.subscription) return false;
  const subscription = outcome.subscription as Record<string, unknown>;
  return (
    typeof subscription.providerSubscriptionId === 'string' &&
    typeof subscription.status === 'string' &&
    isSubscriptionStatus(subscription.status)
  );
}
