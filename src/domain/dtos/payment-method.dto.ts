export interface ListPaymentMethodsInput {
  providerCustomerId: string;
  limit?: number;
}

export interface DeletePaymentMethodInput {
  providerCustomerId: string;
  providerPaymentMethodId: string;
}

export interface PaymentMethodDTO {
  providerPaymentMethodId: string;
  providerCustomerId: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expiresMonth: number | null;
  expiresYear: number | null;
}
