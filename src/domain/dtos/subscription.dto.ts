import type { SubscriptionStatus } from '../value-objects/subscription-status';

export interface SubscriptionLineItem {
  priceId: string;
  quantity: number;
}

export interface SubscriptionProviderItemDTO extends SubscriptionLineItem {
  providerItemId: string | null;
}

export interface CreateSubscriptionInput {
  providerCustomerId: string;
  priceId: string;
  quantity?: number;
  items?: SubscriptionLineItem[];
  trialDays?: number;
  coupon?: string;
}

export interface UpdateSubscriptionInput {
  providerSubscriptionId: string;
  priceId?: string;
  quantity?: number;
  providerItemId?: string | null;
  items?: SubscriptionLineItem[];
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
  items?: readonly SubscriptionProviderItemDTO[];
}
