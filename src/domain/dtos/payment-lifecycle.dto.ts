import type { Money } from '../value-objects/money';
import type { PaymentStatus } from '../value-objects/payment-status';
import type { CheckoutSessionDTO } from './checkout.dto';

export interface PaymentAllocationDTO {
  reference: string;
  amount: Money;
}

export interface AuthorizePaymentInput {
  providerCustomerId?: string;
  amount: Money;
  reference: string;
  description?: string;
  paymentMethodId?: string;
  successUrl?: string;
  cancelUrl?: string;
  providerData?: Record<string, unknown>;
}

export interface AuthorizationResultDTO {
  providerPaymentId?: string;
  status: PaymentStatus;
  amount: Money;
  expiresAt?: Date;
  checkout?: CheckoutSessionDTO;
}

export interface CapturePaymentInput {
  providerPaymentId: string;
  amount?: Money;
  allocations?: PaymentAllocationDTO[];
}

export interface CaptureResultDTO {
  providerPaymentId: string;
  status: PaymentStatus;
  amount: Money;
}

export interface VoidPaymentInput {
  providerPaymentId: string;
}

export interface VoidResultDTO {
  providerPaymentId: string;
  status: PaymentStatus;
}
