import type { PaymentStatus } from '../value-objects/payment-status';
import type { PaymentProvider } from './payment-provider.contract';

export interface RecurringPaymentReconciliationCursor {
  providerPaymentId: string;
  attempt: number;
  nextAttemptAt: string;
  lastProviderStatus: string;
  lastStatus: PaymentStatus;
}

export interface RecurringPaymentReconciliationInput {
  providerPaymentId: string;
  cursor?: RecurringPaymentReconciliationCursor;
}

interface RecurringPaymentReconciliationObservation {
  providerPaymentId: string;
  providerStatus: string;
  status: PaymentStatus;
  attempt: number;
  providerData?: Readonly<Record<string, unknown>>;
}

export interface RecurringPaymentReconciliationRetry
  extends RecurringPaymentReconciliationObservation {
  outcome: 'retry';
  cursor: RecurringPaymentReconciliationCursor;
}

export interface RecurringPaymentReconciliationTerminal
  extends RecurringPaymentReconciliationObservation {
  outcome: 'terminal';
}

export interface RecurringPaymentReconciliationExhausted
  extends RecurringPaymentReconciliationObservation {
  outcome: 'exhausted';
  reason: 'attempt_limit';
}

export type RecurringPaymentReconciliationResult =
  | RecurringPaymentReconciliationRetry
  | RecurringPaymentReconciliationTerminal
  | RecurringPaymentReconciliationExhausted;

export interface RecurringPaymentReconciliationCapable {
  reconcilePaymentRecurring(
    input: RecurringPaymentReconciliationInput,
  ): Promise<RecurringPaymentReconciliationResult>;
}

export function isRecurringPaymentReconciliationCapable(
  provider: PaymentProvider,
): provider is PaymentProvider & RecurringPaymentReconciliationCapable {
  return (
    typeof (provider as Partial<RecurringPaymentReconciliationCapable>)
      .reconcilePaymentRecurring === 'function'
  );
}
