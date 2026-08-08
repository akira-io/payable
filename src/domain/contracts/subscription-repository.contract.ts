import type { Subscription } from '../entities/subscription.entity';
import type { SubscriptionStatus } from '../value-objects/subscription-status';
import type { ListCursor, ListOptions } from './list-options.contract';

type LifecycleMetadataKey =
  | 'scheduledChangeAction'
  | 'scheduledChangeEffectiveAt'
  | 'scheduledResumeAt'
  | 'resumeBillingPolicy'
  | 'paymentCollectionPauseBehavior'
  | 'paymentCollectionResumesAt';

type CanonicalSnapshotKey =
  | 'canonicalPriceId'
  | 'acceptedCurrency'
  | 'acceptedUnitAmount'
  | 'acceptedInterval'
  | 'acceptedIntervalCount'
  | 'acceptedQuantity'
  | 'collectionResponsibility'
  | 'creationSource';

export type NewSubscription = Omit<
  Subscription,
  'id' | 'createdAt' | 'updatedAt' | LifecycleMetadataKey | CanonicalSnapshotKey
> &
  Partial<Pick<Subscription, LifecycleMetadataKey | CanonicalSnapshotKey>>;

export type SubscriptionPatch = Partial<
  Pick<
    Subscription,
    | 'status'
    | 'priceId'
    | 'quantity'
    | 'trialEndsAt'
    | 'endsAt'
    | 'currentPeriodStart'
    | 'currentPeriodEnd'
    | 'providerSyncedAt'
    | LifecycleMetadataKey
  >
>;

export interface SubscriptionListQuery {
  limit: number;
  before?: ListCursor;
  id?: string;
  customerId?: string;
  status?: SubscriptionStatus;
  canonicalPriceId?: string;
  name?: string;
}

export interface SubscriptionListResult {
  items: Subscription[];
  hasMore: boolean;
}

export interface SubscriptionRepository {
  create(data: NewSubscription): Promise<Subscription>;
  update(id: string, patch: SubscriptionPatch, tenantId?: string | null): Promise<Subscription>;
  findById(id: string, tenantId?: string | null): Promise<Subscription | null>;
  findByName(
    customerId: string,
    name: string,
    tenantId?: string | null,
  ): Promise<Subscription | null>;
  findByProviderId(
    provider: string,
    providerSubscriptionId: string,
    tenantId?: string | null,
  ): Promise<Subscription | null>;
  listByCustomer(
    customerId: string,
    tenantId?: string | null,
    options?: ListOptions,
  ): Promise<Subscription[]>;
  list(tenantId?: string | null, options?: ListOptions): Promise<Subscription[]>;
  page?(query: SubscriptionListQuery, tenantId: string | null): Promise<SubscriptionListResult>;
}
