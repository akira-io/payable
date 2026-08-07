import type { OperationContext } from '../dtos/common.dto';
import type { SubscriptionDTO } from '../dtos/subscription.dto';
import type { PaymentProvider } from './payment-provider.contract';

export interface PauseSubscriptionInput {
  providerSubscriptionId: string;
}

export interface PauseSubscriptionCapable {
  pauseSubscription(input: PauseSubscriptionInput, ctx: OperationContext): Promise<SubscriptionDTO>;
}

export function isPauseSubscriptionCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & PauseSubscriptionCapable {
  return typeof (provider as Partial<PauseSubscriptionCapable>).pauseSubscription === 'function';
}
