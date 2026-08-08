import type { NewSubscription } from '../../../../domain/contracts/subscription-repository.contract';
import type {
  SubscriptionPaymentCollectionBehavior,
  SubscriptionResumeBillingPolicy,
} from '../../../../domain/dtos/subscription-operation-capabilities.dto';
import type { RecurringInterval } from '../../../../domain/entities/common';
import type { Subscription } from '../../../../domain/entities/subscription.entity';
import type { CurrencyCode } from '../../../../domain/value-objects/currency';
import type { SubscriptionStatus } from '../../../../domain/value-objects/subscription-status';
import type { PrismaSubscriptionRow } from '../prisma-client.types';

export function subscriptionToEntity(row: PrismaSubscriptionRow): Subscription {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    customerId: row.customerId,
    name: row.name,
    provider: row.provider,
    providerSubscriptionId: row.providerSubscriptionId ?? null,
    status: row.status as SubscriptionStatus,
    priceId: row.priceId ?? null,
    quantity: row.quantity,
    canonicalPriceId: row.canonicalPriceId ?? null,
    acceptedCurrency: (row.acceptedCurrency as CurrencyCode | null) ?? null,
    acceptedUnitAmount: row.acceptedUnitAmount === null ? null : Number(row.acceptedUnitAmount),
    acceptedInterval: (row.acceptedInterval as RecurringInterval | null) ?? null,
    acceptedIntervalCount: row.acceptedIntervalCount ?? null,
    acceptedQuantity: row.acceptedQuantity ?? null,
    collectionResponsibility:
      (row.collectionResponsibility as 'merchant' | 'provider' | null) ?? 'provider',
    creationSource: row.creationSource ?? null,
    trialEndsAt: row.trialEndsAt ?? null,
    endsAt: row.endsAt ?? null,
    currentPeriodStart: row.currentPeriodStart ?? null,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    providerSyncedAt: row.providerSyncedAt ?? null,
    scheduledChangeAction: (row.scheduledChangeAction as 'pause' | 'resume' | null) ?? null,
    scheduledChangeEffectiveAt: row.scheduledChangeEffectiveAt ?? null,
    scheduledResumeAt: row.scheduledResumeAt ?? null,
    resumeBillingPolicy:
      (row.resumeBillingPolicy as SubscriptionResumeBillingPolicy | null) ?? null,
    paymentCollectionPauseBehavior:
      (row.paymentCollectionPauseBehavior as SubscriptionPaymentCollectionBehavior | null) ?? null,
    paymentCollectionResumesAt: row.paymentCollectionResumesAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function subscriptionToRow(data: Partial<NewSubscription>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    tenantKey: data.tenantId === undefined ? undefined : (data.tenantId ?? ''),
    customerId: data.customerId,
    name: data.name,
    provider: data.provider,
    providerSubscriptionId: data.providerSubscriptionId,
    status: data.status,
    priceId: data.priceId,
    quantity: data.quantity,
    canonicalPriceId: data.canonicalPriceId,
    acceptedCurrency: data.acceptedCurrency,
    acceptedUnitAmount: data.acceptedUnitAmount,
    acceptedInterval: data.acceptedInterval,
    acceptedIntervalCount: data.acceptedIntervalCount,
    acceptedQuantity: data.acceptedQuantity,
    collectionResponsibility: data.collectionResponsibility,
    creationSource: data.creationSource,
    trialEndsAt: data.trialEndsAt,
    endsAt: data.endsAt,
    currentPeriodStart: data.currentPeriodStart,
    currentPeriodEnd: data.currentPeriodEnd,
    providerSyncedAt: data.providerSyncedAt,
    scheduledChangeAction: data.scheduledChangeAction,
    scheduledChangeEffectiveAt: data.scheduledChangeEffectiveAt,
    scheduledResumeAt: data.scheduledResumeAt,
    resumeBillingPolicy: data.resumeBillingPolicy,
    paymentCollectionPauseBehavior: data.paymentCollectionPauseBehavior,
    paymentCollectionResumesAt: data.paymentCollectionResumesAt,
  };
}
