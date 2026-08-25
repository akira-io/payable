import type { ListOptions } from '../../../../domain/contracts/list-options.contract';
import type {
  NewSubscription,
  SubscriptionListQuery,
  SubscriptionListResult,
  SubscriptionPatch,
  SubscriptionRepository,
} from '../../../../domain/contracts/subscription-repository.contract';
import type {
  SubscriptionPaymentCollectionBehavior,
  SubscriptionResumeBillingPolicy,
} from '../../../../domain/dtos/subscription-operation-capabilities.dto';
import type { RecurringInterval } from '../../../../domain/entities/common';
import type { Subscription } from '../../../../domain/entities/subscription.entity';
import type { CurrencyCode } from '../../../../domain/value-objects/currency';
import type { SubscriptionStatus } from '../../../../domain/value-objects/subscription-status';
import { KnexRepository } from '../knex-repository';
import { fromDate, toDate, toNullableDate } from '../mappers';

export class KnexSubscriptionRepository
  extends KnexRepository<Subscription, NewSubscription, SubscriptionPatch>
  implements SubscriptionRepository
{
  protected readonly table = 'payable_subscriptions';

  findByName(
    customerId: string,
    name: string,
    tenantId?: string | null,
  ): Promise<Subscription | null> {
    const where = { customer_id: customerId, name };
    return this.firstWhere(tenantId == null ? where : { ...where, tenant_id: tenantId });
  }

  findByProviderId(
    provider: string,
    providerSubscriptionId: string,
    tenantId?: string | null,
  ): Promise<Subscription | null> {
    const where = { provider, provider_subscription_id: providerSubscriptionId };
    return this.firstWhere(tenantId == null ? where : { ...where, tenant_id: tenantId });
  }

  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Subscription[]> {
    return this.manyWhere({ customer_id: customerId, ...this.tenantClause(tenantId) }, options);
  }

  list(tenantId?: string | null, options?: ListOptions): Promise<Subscription[]> {
    return this.manyWhere(this.tenantClause(tenantId), options);
  }

  async page(
    query: SubscriptionListQuery,
    tenantId: string | null,
  ): Promise<SubscriptionListResult> {
    let subscriptions = this.knex(this.table)
      .where('tenant_key', tenantId ?? '')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.id) subscriptions = subscriptions.where('id', query.id);
    if (query.customerId) subscriptions = subscriptions.where('customer_id', query.customerId);
    if (query.status) subscriptions = subscriptions.where('status', query.status);
    if (query.canonicalPriceId) {
      subscriptions = subscriptions.where('canonical_price_id', query.canonicalPriceId);
    }
    if (query.canonicalProductId) {
      subscriptions = subscriptions.where('canonical_product_id', query.canonicalProductId);
    }
    if (query.name) subscriptions = subscriptions.where('name', query.name);
    if (query.before) {
      const before = query.before;
      const createdAt = before.createdAt.toISOString();
      subscriptions = subscriptions.where((subscription) =>
        subscription
          .where('created_at', '<', createdAt)
          .orWhere((tie) => tie.where('created_at', createdAt).andWhere('id', '<', before.id)),
      );
    }
    const rows = (await subscriptions.limit(query.limit + 1)) as Record<string, unknown>[];
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > query.limit,
    };
  }

  protected toEntity(row: Record<string, unknown>): Subscription {
    return {
      id: row.id as string,
      tenantId: (row.tenant_id as string | null) ?? null,
      customerId: row.customer_id as string,
      name: row.name as string,
      provider: (row.provider as string | null) ?? null,
      providerSubscriptionId: (row.provider_subscription_id as string | null) ?? null,
      status: row.status as SubscriptionStatus,
      priceId: (row.price_id as string | null) ?? null,
      quantity: row.quantity as number,
      canonicalPriceId: (row.canonical_price_id as string | null) ?? null,
      canonicalProductId: (row.canonical_product_id as string | null) ?? null,
      acceptedCurrency: (row.accepted_currency as CurrencyCode | null) ?? null,
      acceptedUnitAmount: (row.accepted_unit_amount as number | null) ?? null,
      acceptedInterval: (row.accepted_interval as RecurringInterval | null) ?? null,
      acceptedIntervalCount: (row.accepted_interval_count as number | null) ?? null,
      acceptedQuantity: (row.accepted_quantity as number | null) ?? null,
      collectionResponsibility:
        (row.collection_responsibility as 'merchant' | 'provider' | null) ?? 'provider',
      creationSource: (row.creation_source as string | null) ?? null,
      trialEndsAt: toNullableDate(row.trial_ends_at),
      endsAt: toNullableDate(row.ends_at),
      currentPeriodStart: toNullableDate(row.current_period_start),
      currentPeriodEnd: toNullableDate(row.current_period_end),
      providerSyncedAt: toNullableDate(row.provider_synced_at),
      scheduledChangeAction: (row.scheduled_change_action as 'pause' | 'resume' | null) ?? null,
      scheduledChangeEffectiveAt: toNullableDate(row.scheduled_change_effective_at),
      scheduledResumeAt: toNullableDate(row.scheduled_resume_at),
      resumeBillingPolicy:
        (row.resume_billing_policy as SubscriptionResumeBillingPolicy | null) ?? null,
      paymentCollectionPauseBehavior:
        (row.payment_collection_pause_behavior as SubscriptionPaymentCollectionBehavior | null) ??
        null,
      paymentCollectionResumesAt: toNullableDate(row.payment_collection_resumes_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  protected toRow(data: Partial<NewSubscription>): Record<string, unknown> {
    return {
      tenant_id: data.tenantId,
      tenant_key: data.tenantId === undefined ? undefined : (data.tenantId ?? ''),
      customer_id: data.customerId,
      name: data.name,
      provider: data.provider,
      provider_subscription_id: data.providerSubscriptionId,
      status: data.status,
      price_id: data.priceId,
      quantity: data.quantity,
      canonical_price_id: data.canonicalPriceId,
      canonical_product_id: data.canonicalProductId,
      accepted_currency: data.acceptedCurrency,
      accepted_unit_amount: data.acceptedUnitAmount,
      accepted_interval: data.acceptedInterval,
      accepted_interval_count: data.acceptedIntervalCount,
      accepted_quantity: data.acceptedQuantity,
      collection_responsibility: data.collectionResponsibility,
      creation_source: data.creationSource,
      trial_ends_at: fromDate(data.trialEndsAt),
      ends_at: fromDate(data.endsAt),
      current_period_start: fromDate(data.currentPeriodStart),
      current_period_end: fromDate(data.currentPeriodEnd),
      provider_synced_at: fromDate(data.providerSyncedAt),
      scheduled_change_action: data.scheduledChangeAction,
      scheduled_change_effective_at: fromDate(data.scheduledChangeEffectiveAt),
      scheduled_resume_at: fromDate(data.scheduledResumeAt),
      resume_billing_policy: data.resumeBillingPolicy,
      payment_collection_pause_behavior: data.paymentCollectionPauseBehavior,
      payment_collection_resumes_at: fromDate(data.paymentCollectionResumesAt),
    };
  }

  protected override toUpdateRow(data: SubscriptionPatch): Record<string, unknown> {
    return {
      status: data.status,
      price_id: data.priceId,
      quantity: data.quantity,
      trial_ends_at: fromDate(data.trialEndsAt),
      ends_at: fromDate(data.endsAt),
      current_period_start: fromDate(data.currentPeriodStart),
      current_period_end: fromDate(data.currentPeriodEnd),
      provider_synced_at: fromDate(data.providerSyncedAt),
      canonical_price_id: data.canonicalPriceId,
      canonical_product_id: data.canonicalProductId,
      accepted_currency: data.acceptedCurrency,
      accepted_unit_amount: data.acceptedUnitAmount,
      accepted_interval: data.acceptedInterval,
      accepted_interval_count: data.acceptedIntervalCount,
      accepted_quantity: data.acceptedQuantity,
      scheduled_change_action: data.scheduledChangeAction,
      scheduled_change_effective_at: fromDate(data.scheduledChangeEffectiveAt),
      scheduled_resume_at: fromDate(data.scheduledResumeAt),
      resume_billing_policy: data.resumeBillingPolicy,
      payment_collection_pause_behavior: data.paymentCollectionPauseBehavior,
      payment_collection_resumes_at: fromDate(data.paymentCollectionResumesAt),
    };
  }
}
