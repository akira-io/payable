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

export function isSubscriptionChangeCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & SubscriptionChangeCapable {
  const candidate = provider as Partial<SubscriptionChangeCapable>;
  return (
    typeof candidate.previewSubscriptionChange === 'function' &&
    typeof candidate.applySubscriptionChange === 'function'
  );
}
