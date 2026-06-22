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
}
