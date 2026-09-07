import type { Money } from '../value-objects/money';
import type { PaymentStatus } from '../value-objects/payment-status';
import type { PaymentProvider } from './payment-provider.contract';

export interface RedirectCallbackResult {
  providerPaymentId: string;
  checkoutSessionId?: string;
  status: PaymentStatus;
  amount?: Money;
}

export interface RedirectCallbackContext {
  checkoutSessionId?: string;
}

export interface RedirectCallbackCapable {
  verifyCallback(
    payload: Record<string, unknown>,
    context?: RedirectCallbackContext,
  ): boolean | Promise<boolean>;
  handleRedirectCallback(
    payload: Record<string, unknown>,
    context?: RedirectCallbackContext,
  ): Promise<RedirectCallbackResult>;
}

export function isRedirectCallbackCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & RedirectCallbackCapable {
  const candidate = provider as Partial<RedirectCallbackCapable>;
  return (
    typeof candidate.verifyCallback === 'function' &&
    typeof candidate.handleRedirectCallback === 'function'
  );
}
