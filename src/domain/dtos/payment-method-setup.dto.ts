export type PaymentMethodSetupUsage = 'on_session' | 'off_session';

export type PaymentMethodSetupStatus =
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'canceled'
  | 'failed'
  | 'unknown';

export interface CreatePaymentMethodSetupInput {
  providerCustomerId: string;
  usage: PaymentMethodSetupUsage;
  currency?: string;
  paymentMethodTypes?: string[];
  returnUrl?: string;
  reference?: string;
}

export interface ConfirmPaymentMethodSetupInput {
  providerSetupId: string;
  providerReturn: string;
}

export interface PaymentMethodSetupPaymentMethodDTO {
  type: 'card';
  brand: string | null;
  lastFour: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
}

export interface PaymentMethodSetupDTO {
  providerSetupId: string;
  providerCustomerId: string;
  status: PaymentMethodSetupStatus;
  usage: PaymentMethodSetupUsage;
  clientSecret: string | null;
  checkoutUrl: string | null;
  providerPaymentMethodId: string | null;
  paymentMethod?: PaymentMethodSetupPaymentMethodDTO;
  createdAt: Date | null;
}
