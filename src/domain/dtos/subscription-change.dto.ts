import type {
  SubscriptionEffectiveTiming,
  SubscriptionPaymentFailurePolicy,
  SubscriptionProrationPolicy,
} from './subscription-operation-capabilities.dto';

export interface SubscriptionChangePolicies {
  effectiveTiming: SubscriptionEffectiveTiming;
  prorationPolicy: SubscriptionProrationPolicy;
  paymentFailurePolicy: SubscriptionPaymentFailurePolicy;
}

export interface SubscriptionChangeItem {
  itemId: string;
  providerItemId: string | null;
  priceId: string;
  quantity: number;
}

export interface SubscriptionChangeMoney {
  direction: 'charge' | 'credit' | 'none' | 'unknown';
  amount: number | null;
  currency: string | null;
}

export interface SubscriptionChangeRenewal {
  amount: number | null;
  date: Date | null;
  currency: string | null;
}

export interface SubscriptionChangePreview extends SubscriptionChangePolicies {
  previewToken: string;
  provider: string;
  subscriptionId: string;
  currentItems: readonly SubscriptionChangeItem[];
  proposedItems: readonly SubscriptionChangeItem[];
  calculatedAt: Date;
  expiresAt: Date;
  currentRenewalDate: Date | null;
  immediateAdjustment: SubscriptionChangeMoney;
  nextRenewal: SubscriptionChangeRenewal;
  warnings: readonly string[];
  providerLimitations: readonly string[];
}

export interface PreviewSubscriptionChangeInput extends SubscriptionChangePolicies {
  priceId?: string;
  quantity?: number;
  itemId?: string;
  idempotencyKey: string;
}

export interface ApplySubscriptionChangeInput {
  previewToken: string;
  idempotencyKey: string;
}

export interface ProviderSubscriptionChangeInput extends SubscriptionChangePolicies {
  providerSubscriptionId: string;
  currentItems: readonly SubscriptionChangeItem[];
  proposedItems: readonly SubscriptionChangeItem[];
  calculatedAt: Date;
  renewalDate: Date | null;
}

export type ProviderSubscriptionChangePreview = Pick<
  SubscriptionChangePreview,
  'immediateAdjustment' | 'nextRenewal' | 'warnings' | 'providerLimitations'
>;
