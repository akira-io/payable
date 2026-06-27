import type { NewSubscription } from '../../../../domain/contracts/subscription-repository.contract';
import type { Subscription } from '../../../../domain/entities/subscription.entity';
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
    trialEndsAt: row.trialEndsAt ?? null,
    endsAt: row.endsAt ?? null,
    currentPeriodStart: row.currentPeriodStart ?? null,
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function subscriptionToRow(data: Partial<NewSubscription>): Record<string, unknown> {
  return {
    tenantId: data.tenantId,
    customerId: data.customerId,
    name: data.name,
    provider: data.provider,
    providerSubscriptionId: data.providerSubscriptionId,
    status: data.status,
    priceId: data.priceId,
    quantity: data.quantity,
    trialEndsAt: data.trialEndsAt,
    endsAt: data.endsAt,
    currentPeriodStart: data.currentPeriodStart,
    currentPeriodEnd: data.currentPeriodEnd,
  };
}
