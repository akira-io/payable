import type { Money } from '../value-objects/money';

export type CheckoutMode = 'payment' | 'subscription';

export interface CheckoutLineItem {
  priceId: string;
  quantity: number;
}

export interface CreateCheckoutSessionInput {
  providerCustomerId: string;
  mode: CheckoutMode;
  lineItems: CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  reference?: string;
  trialDays?: number;
  coupon?: string;
  amount?: Money;
  providerData?: Record<string, unknown>;
}

export interface CheckoutSessionDTO {
  id: string;
  url: string;
  html?: string;
}
