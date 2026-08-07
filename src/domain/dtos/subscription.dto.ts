import type { SubscriptionStatus } from '../value-objects/subscription-status';
import type {
  SubscriptionPaymentCollectionBehavior,
  SubscriptionResumeBillingPolicy,
} from './subscription-operation-capabilities.dto';

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
  scheduledChangeAction?: 'pause' | 'resume' | null;
  scheduledChangeEffectiveAt?: Date | null;
  scheduledResumeAt?: Date | null;
  resumeBillingPolicy?: SubscriptionResumeBillingPolicy | null;
  paymentCollectionPauseBehavior?: SubscriptionPaymentCollectionBehavior | null;
  paymentCollectionResumesAt?: Date | null;
  items?: readonly SubscriptionProviderItemDTO[];
}
