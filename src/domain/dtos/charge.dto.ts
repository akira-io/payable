import type { Money } from '../value-objects/money';
import type { PaymentStatus } from '../value-objects/payment-status';

export interface ChargeInput {
  providerCustomerId?: string;
  amount: Money;
  reference?: string;
  description?: string;
  paymentMethodId?: string;
  offSession?: boolean;
  providerData?: Record<string, unknown>;
}

export interface ChargeResultDTO {
  providerPaymentId: string;
  status: PaymentStatus;
  amount: Money;
}
