import type { Money } from '../value-objects/money';
import type { PaymentStatus } from '../value-objects/payment-status';

export interface ChargeInput {
  providerCustomerId?: string;
  amount: Money;
  reference?: string;
  description?: string;
}

export interface ChargeResultDTO {
  providerPaymentId: string;
  status: PaymentStatus;
  amount: Money;
}
