import type { Money } from '../value-objects/money';
import type { PaymentProvider } from './payment-provider.contract';

export interface CheckoutSessionReconciliationInput {
  checkoutSessionId: string;
}

export interface UnsettledCheckoutSession {
  outcome: 'unsettled';
  checkoutSessionId: string;
  status: 'failed';
  amount: Money;
}

export interface SettledCheckoutSession {
  outcome: 'settled';
  checkoutSessionId: string;
  bookingTransactionIds: string[];
}

export type CheckoutSessionReconciliationResult = UnsettledCheckoutSession | SettledCheckoutSession;

export interface CheckoutSessionReconciliationCapable {
  reconcileCheckoutSession(
    input: CheckoutSessionReconciliationInput,
  ): Promise<CheckoutSessionReconciliationResult>;
}

export function isCheckoutSessionReconciliationCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & CheckoutSessionReconciliationCapable {
  return (
    typeof (provider as Partial<CheckoutSessionReconciliationCapable>).reconcileCheckoutSession ===
    'function'
  );
}
