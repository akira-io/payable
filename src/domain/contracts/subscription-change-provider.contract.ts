import type { OperationContext } from '../dtos/common.dto';
import type { SubscriptionDTO } from '../dtos/subscription.dto';
import type {
  ProviderSubscriptionChangeInput,
  ProviderSubscriptionChangePreview,
} from '../dtos/subscription-change.dto';
import type { PaymentProvider } from './payment-provider.contract';

export interface SubscriptionChangeCapable {
  previewSubscriptionChange(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<ProviderSubscriptionChangePreview>;
  applySubscriptionChange(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<SubscriptionDTO>;
}

export type SubscriptionChangeApplicationOutcome =
  | { kind: 'applied'; subscription: SubscriptionDTO }
  | {
      kind: 'not_applied';
      sideEffects: 'definitively_none';
      code: string;
      message?: string;
    };

export interface SubscriptionChangeOutcomeCapable {
  applySubscriptionChangeWithOutcome(
    input: ProviderSubscriptionChangeInput,
    context: OperationContext,
  ): Promise<SubscriptionChangeApplicationOutcome>;
}

export function isSubscriptionChangeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & SubscriptionChangeCapable {
  const candidate = provider as Partial<SubscriptionChangeCapable>;
  return (
    typeof candidate.previewSubscriptionChange === 'function' &&
    typeof candidate.applySubscriptionChange === 'function'
  );
}

export function isSubscriptionChangeOutcomeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & SubscriptionChangeOutcomeCapable {
  return (
    typeof (provider as Partial<SubscriptionChangeOutcomeCapable>)
      .applySubscriptionChangeWithOutcome === 'function'
  );
}
