import type { StoredSubscriptionPriceMigrationRow } from '../mappers/subscription-price-migration.mapper';
import type {
  PrismaCanonicalPriceRow,
  PrismaCanonicalProductRow,
  PrismaCatalogSynchronizationRow,
  PrismaPriceProviderBindingRow,
  PrismaProductProviderBindingRow,
} from './prisma-canonical-catalog-row.types';
import type { PrismaCollectionEvidenceRow } from './prisma-collection-evidence.types';
import type {
  PrismaCanonicalInvoiceRow,
  PrismaInvoicePaymentRow,
  PrismaInvoiceProviderBindingRow,
  PrismaInvoiceRow,
} from './prisma-invoice-row.types';
import type { PrismaSubscriptionMutationClaimRow } from './prisma-subscription-mutation-claim-row.types';
import type { PrismaSubscriptionRow } from './prisma-subscription-row.types';
import type {
  PrismaWebhookDeliveryRow,
  PrismaWebhookEndpointEventRow,
  PrismaWebhookEndpointRow,
  PrismaWebhookEventRow,
} from './prisma-webhook-row.types';

export type {
  PrismaCanonicalPriceRow,
  PrismaCanonicalProductRow,
  PrismaCatalogSynchronizationRow,
  PrismaPriceProviderBindingRow,
  PrismaProductProviderBindingRow,
} from './prisma-canonical-catalog-row.types';
export type { PrismaInvoiceRow } from './prisma-invoice-row.types';
export type { PrismaSubscriptionMutationClaimRow } from './prisma-subscription-mutation-claim-row.types';
export type { PrismaSubscriptionRow } from './prisma-subscription-row.types';
export type {
  PrismaWebhookDeliveryRow,
  PrismaWebhookEndpointEventRow,
  PrismaWebhookEndpointRow,
  PrismaWebhookEventRow,
} from './prisma-webhook-row.types';

export interface PrismaCustomerRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  billableType: string;
  billableId: string;
  email: string;
  name: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaCustomerProviderBindingRow {
  id: string;
  customerId: string;
  provider: string;
  providerCustomerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaSubscriptionProviderBindingRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  subscriptionId: string;
  provider: string;
  providerSubscriptionId: string;
  providerSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaCustomerProviderSyncStateRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  customerId: string;
  provider: string;
  status: string;
  providerCustomerId: string | null;
  attempts: number;
  lastAttemptedAt: Date;
  synchronizedAt: Date | null;
  failureCode: string | null;
  attemptOwnerId: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaProductRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  provider: string;
  providerProductId: string | null;
  name: string;
  description: string | null;
  active: boolean;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaPriceRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  provider: string;
  providerPriceId: string | null;
  productId: string;
  currency: string;
  unitAmount: bigint;
  interval: string | null;
  intervalCount: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaSubscriptionItemRow {
  id: string;
  subscriptionId: string;
  priceId: string;
  providerItemId: string | null;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaPaymentRow extends PrismaCollectionEvidenceRow {
  id: string;
  tenantId: string | null;
  tenantKey: string;
  customerId: string | null;
  provider: string | null;
  providerPaymentId: string | null;
  status: string;
  currency: string;
  amount: bigint;
  refundedAmount: bigint;
  capturedAmount: bigint;
  authorizedAt: Date | null;
  authorizationExpiresAt: Date | null;
  reference: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaRefundRow extends PrismaCollectionEvidenceRow {
  id: string;
  tenantId: string | null;
  paymentId: string;
  provider: string | null;
  providerRefundId: string | null;
  status: string;
  currency: string;
  amount: bigint;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaAuditLogRow {
  id: string;
  tenantId: string;
  correlationId: string;
  actorType: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  before: string | null;
  after: string | null;
  metadata: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  previousHash: string | null;
  hash: string;
  sequence: number | null;
  createdAt: Date;
}

export interface PrismaOutboxEventRow {
  id: string;
  tenantId: string | null;
  tenantKey?: string;
  correlationId: string;
  eventType: string;
  eventVersion: number;
  payload: string;
  status: string;
  attempts: number;
  nextRetryAt: Date | null;
  lockedBy: string | null;
  lockedUntil: Date | null;
  dedupeKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaIdempotencyKeyRow {
  id: string;
  tenantId: string;
  key: string;
  scope: string;
  operation: string;
  resourceType: string | null;
  resourceId: string | null;
  requestHash: string;
  response: string | null;
  status: string;
  lockedUntil: Date | null;
  lockToken: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaWhere {
  where?: Record<string, unknown>;
}

export interface PrismaFindFirstArgs extends PrismaWhere {
  orderBy?: unknown;
}

export interface PrismaFindManyArgs extends PrismaFindFirstArgs {
  take?: number;
  skip?: number;
  cursor?: Record<string, unknown>;
}

export interface PrismaCountResult {
  count: number;
}

export interface PrismaDelegate<Row> {
  create(args: { data: Record<string, unknown> }): Promise<Row>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<PrismaCountResult>;
  findFirst(args?: PrismaFindFirstArgs): Promise<Row | null>;
  findMany(args?: PrismaFindManyArgs): Promise<Row[]>;
  findUnique(args: { where: Record<string, unknown> }): Promise<Row | null>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<Row>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<PrismaCountResult>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<PrismaCountResult>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<Row>;
  count(args?: { where?: Record<string, unknown> }): Promise<number>;
}

export interface PrismaModelDelegates {
  payableCustomer: PrismaDelegate<PrismaCustomerRow>;
  payableCustomerProviderBinding: PrismaDelegate<PrismaCustomerProviderBindingRow>;
  payableCustomerProviderSyncState: PrismaDelegate<PrismaCustomerProviderSyncStateRow>;
  payableProduct: PrismaDelegate<PrismaProductRow>;
  payablePrice: PrismaDelegate<PrismaPriceRow>;
  payableCanonicalProduct: PrismaDelegate<PrismaCanonicalProductRow>;
  payableCanonicalPrice: PrismaDelegate<PrismaCanonicalPriceRow>;
  payableCatalogSynchronization: PrismaDelegate<PrismaCatalogSynchronizationRow>;
  payableProductProviderBinding: PrismaDelegate<PrismaProductProviderBindingRow>;
  payablePriceProviderBinding: PrismaDelegate<PrismaPriceProviderBindingRow>;
  payableSubscription: PrismaDelegate<PrismaSubscriptionRow>;
  payableSubscriptionProviderBinding: PrismaDelegate<PrismaSubscriptionProviderBindingRow>;
  payableSubscriptionItem: PrismaDelegate<PrismaSubscriptionItemRow>;
  payableSubscriptionPriceMigration: PrismaDelegate<StoredSubscriptionPriceMigrationRow>;
  payableSubscriptionMutationClaim: PrismaDelegate<PrismaSubscriptionMutationClaimRow>;
  payableInvoice: PrismaDelegate<PrismaInvoiceRow>;
  payableCanonicalInvoice: PrismaDelegate<PrismaCanonicalInvoiceRow>;
  payableInvoiceProviderBinding: PrismaDelegate<PrismaInvoiceProviderBindingRow>;
  payableInvoicePayment: PrismaDelegate<PrismaInvoicePaymentRow>;
  payablePayment: PrismaDelegate<PrismaPaymentRow>;
  payableRefund: PrismaDelegate<PrismaRefundRow>;
  payableWebhookEvent: PrismaDelegate<PrismaWebhookEventRow>;
  payableWebhookEndpoint: PrismaDelegate<PrismaWebhookEndpointRow>;
  payableWebhookEndpointEvent: PrismaDelegate<PrismaWebhookEndpointEventRow>;
  payableWebhookDelivery: PrismaDelegate<PrismaWebhookDeliveryRow>;
  payableAuditLog: PrismaDelegate<PrismaAuditLogRow>;
  payableOutboxEvent: PrismaDelegate<PrismaOutboxEventRow>;
  payableIdempotencyKey: PrismaDelegate<PrismaIdempotencyKeyRow>;
}

export type PrismaTransactionLike = PrismaModelDelegates;
export interface PrismaClientLike extends PrismaModelDelegates {
  $transaction<T>(work: (tx: PrismaTransactionLike) => Promise<T>): Promise<T>;
}
export type PrismaClient = PrismaClientLike | PrismaTransactionLike;
