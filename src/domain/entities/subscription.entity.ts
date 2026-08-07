import type {
  SubscriptionPaymentCollectionBehavior,
  SubscriptionResumeBillingPolicy,
} from '../dtos/subscription-operation-capabilities.dto';
import type { SubscriptionStatus } from '../value-objects/subscription-status';
import type { TenantScoped, Timestamps } from './common';

export interface Subscription extends TenantScoped, Timestamps {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly provider: string;
  readonly providerSubscriptionId: string | null;
  readonly status: SubscriptionStatus;
  readonly priceId: string | null;
  readonly quantity: number;
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
