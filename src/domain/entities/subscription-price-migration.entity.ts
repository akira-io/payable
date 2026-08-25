import type {
  SubscriptionPaymentFailurePolicy,
  SubscriptionProrationPolicy,
} from '../dtos/subscription-operation-capabilities.dto';
import type {
  SubscriptionPriceMigrationFailure,
  SubscriptionPriceMigrationFailureCode,
} from '../value-objects/subscription-price-migration-failure';
import type { SubscriptionPriceMigrationStatus } from '../value-objects/subscription-price-migration-status';
import type { TenantScoped, Timestamps } from './common';

export interface SubscriptionPriceSnapshot {
  readonly id: string;
  readonly productId: string;
  readonly amount: number;
  readonly currency: string;
  readonly interval: string | null;
  readonly intervalCount: number | null;
}

export interface SubscriptionPriceMigrationItemSnapshot {
  readonly id: string;
  readonly priceId: string;
  readonly quantity: number;
}

export interface SubscriptionPriceMigrationAdjustment {
  readonly direction: 'charge' | 'credit' | 'none' | 'unknown';
  readonly amount: number | null;
  readonly currency: string | null;
}

export interface SubscriptionPriceMigrationRenewal {
  readonly amount: number | null;
  readonly currency: string | null;
  readonly date: Date | null;
}

interface SubscriptionPriceMigrationBase extends TenantScoped, Timestamps {
  readonly id: string;
  readonly subscriptionId: string;
  readonly primaryItemId: string;
  readonly sourcePriceId: string;
  readonly targetPriceId: string;
  readonly sourcePrice: SubscriptionPriceSnapshot;
  readonly targetPrice: SubscriptionPriceSnapshot;
  readonly currentItems: readonly SubscriptionPriceMigrationItemSnapshot[];
  readonly proposedItems: readonly SubscriptionPriceMigrationItemSnapshot[];
  readonly prorationPolicy: SubscriptionProrationPolicy;
  readonly paymentFailurePolicy: SubscriptionPaymentFailurePolicy;
  readonly immediateAdjustment: SubscriptionPriceMigrationAdjustment;
  readonly nextRenewal: SubscriptionPriceMigrationRenewal;
  readonly currentRenewalDate: Date | null;
  readonly warnings: readonly string[];
  readonly providerLimitations: readonly string[];
  readonly previewToken: string;
  readonly requestHash: string;
  readonly calculatedAt: Date;
  readonly expiresAt: Date;
  readonly providerBindingId: string;
  readonly status: SubscriptionPriceMigrationStatus;
  readonly attemptCount: number;
  readonly executionToken: string | null;
  readonly failureCode: SubscriptionPriceMigrationFailureCode | null;
  readonly failureMessage: SubscriptionPriceMigrationFailure['message'] | null;
  readonly scheduledAt: Date | null;
  readonly executionStartedAt: Date | null;
  readonly appliedAt: Date | null;
  readonly failedAt: Date | null;
  readonly reconciliationRequiredAt: Date | null;
  readonly reconciliationOutcome: 'applied' | 'not_applied' | null;
  readonly reconciliationEvidenceReference: string | null;
  readonly reconciliationResolvedAt: Date | null;
  readonly reconciliationObservationEvidenceReference: string | null;
  readonly reconciliationObservedAt: Date | null;
  readonly cancelledAt: Date | null;
}

export type SubscriptionPriceMigration =
  | (SubscriptionPriceMigrationBase & {
      readonly effectiveTiming: 'immediate';
      readonly effectiveAt: null;
    })
  | (SubscriptionPriceMigrationBase & {
      readonly effectiveTiming: 'nextRenewal';
      readonly effectiveAt: null;
    })
  | (SubscriptionPriceMigrationBase & {
      readonly effectiveTiming: 'scheduled';
      readonly effectiveAt: Date;
    });
