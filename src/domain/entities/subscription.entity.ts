import type {
  SubscriptionPaymentCollectionBehavior,
  SubscriptionResumeBillingPolicy,
} from '../dtos/subscription-operation-capabilities.dto';
import type { CurrencyCode } from '../value-objects/currency';
import type { SubscriptionStatus } from '../value-objects/subscription-status';
import type { RecurringInterval, TenantScoped, Timestamps } from './common';

export type SubscriptionCollectionResponsibility = 'merchant' | 'provider';

export interface Subscription extends TenantScoped, Timestamps {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly provider: string | null;
  readonly providerSubscriptionId: string | null;
  readonly status: SubscriptionStatus;
  readonly priceId: string | null;
  readonly quantity: number;
  readonly canonicalPriceId: string | null;
  readonly canonicalProductId: string | null;
  readonly acceptedCurrency: CurrencyCode | null;
  readonly acceptedUnitAmount: number | null;
  readonly acceptedInterval: RecurringInterval | null;
  readonly acceptedIntervalCount: number | null;
  readonly acceptedQuantity: number | null;
  readonly collectionResponsibility: SubscriptionCollectionResponsibility;
  readonly creationSource: string | null;
  readonly trialEndsAt: Date | null;
  readonly endsAt: Date | null;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly providerSyncedAt?: Date | null;
  readonly scheduledChangeAction: 'pause' | 'resume' | null;
  readonly scheduledChangeEffectiveAt: Date | null;
  readonly scheduledResumeAt: Date | null;
  readonly resumeBillingPolicy: SubscriptionResumeBillingPolicy | null;
  readonly paymentCollectionPauseBehavior: SubscriptionPaymentCollectionBehavior | null;
  readonly paymentCollectionResumesAt: Date | null;
}
