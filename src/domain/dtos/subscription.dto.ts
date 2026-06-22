import type { SubscriptionStatus } from '../value-objects/subscription-status';

export interface CreateSubscriptionInput {
  providerCustomerId: string;
  priceId: string;
  quantity?: number;
  trialDays?: number;
  coupon?: string;
}

export interface UpdateSubscriptionInput {
  providerSubscriptionId: string;
  priceId?: string;
  quantity?: number;
}

export interface CancelSubscriptionInput {
  providerSubscriptionId: string;
  immediately?: boolean;
}

export interface SubscriptionDTO {
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
}
