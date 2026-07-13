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

export interface PaymentMethodSetupDTO {
  providerSetupId: string;
  providerCustomerId: string;
  status: PaymentMethodSetupStatus;
  usage: PaymentMethodSetupUsage;
  clientSecret: string | null;
  checkoutUrl: string | null;
  providerPaymentMethodId: string | null;
  createdAt: Date | null;
}
