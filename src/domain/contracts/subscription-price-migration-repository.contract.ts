import type { SubscriptionPriceMigration } from '../entities/subscription-price-migration.entity';
import type {
  SubscriptionPriceMigrationFailure,
  SubscriptionPriceMigrationFailureCode,
} from '../value-objects/subscription-price-migration-failure';
import type { SubscriptionPriceMigrationStatus } from '../value-objects/subscription-price-migration-status';
import type { ListCursor } from './list-options.contract';

type SubscriptionPriceMigrationCreationManagedKey =
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'status'
  | 'attemptCount'
  | 'executionToken'
  | 'failureCode'
  | 'failureMessage'
  | 'scheduledAt'
  | 'executionStartedAt'
  | 'appliedAt'
  | 'failedAt'
  | 'reconciliationRequiredAt'
  | 'reconciliationOutcome'
  | 'reconciliationEvidenceReference'
  | 'reconciliationResolvedAt'
  | 'reconciliationObservationEvidenceReference'
  | 'reconciliationObservedAt'
  | 'cancelledAt';

interface NewSubscriptionPriceMigrationLifecycle {
  readonly status: 'previewed';
  readonly attemptCount: 0;
  readonly executionToken: null;
  readonly failureCode: null;
  readonly failureMessage: null;
  readonly scheduledAt: null;
  readonly executionStartedAt: null;
  readonly appliedAt: null;
  readonly failedAt: null;
  readonly reconciliationRequiredAt: null;
  readonly reconciliationOutcome: null;
  readonly reconciliationEvidenceReference: null;
  readonly reconciliationResolvedAt: null;
  readonly reconciliationObservationEvidenceReference: null;
  readonly reconciliationObservedAt: null;
  readonly cancelledAt: null;
}

export type NewSubscriptionPriceMigration = SubscriptionPriceMigration extends infer Migration
  ? Migration extends SubscriptionPriceMigration
    ? Omit<Migration, SubscriptionPriceMigrationCreationManagedKey> &
        NewSubscriptionPriceMigrationLifecycle
    : never
  : never;

export interface SubscriptionPriceMigrationListQuery {
  readonly limit: number;
  readonly before?: ListCursor;
  readonly id?: string;
  readonly subscriptionId?: string;
  readonly status?: SubscriptionPriceMigrationStatus;
}

export interface SubscriptionPriceMigrationListResult {
  readonly items: SubscriptionPriceMigration[];
  readonly hasMore: boolean;
}

export interface SubscriptionPriceMigrationDueCursor {
  readonly effectiveAt: Date;
  readonly id: string;
}

export interface SubscriptionPriceMigrationDuePageQuery {
  readonly limit: number;
  readonly dueBefore: Date;
  readonly before?: SubscriptionPriceMigrationDueCursor;
}

interface SubscriptionPriceMigrationStateCompareAndSwapBase {
  readonly id: string;
  readonly tenantId: string | null;
  readonly attemptCount: number;
  readonly failureCode: SubscriptionPriceMigrationFailureCode | null;
  readonly failureMessage: SubscriptionPriceMigrationFailure['message'] | null;
  readonly executionStartedAt: Date | null;
  readonly appliedAt: Date | null;
  readonly failedAt: Date | null;
  readonly reconciliationRequiredAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly updatedAt: Date;
}

export interface ScheduleSubscriptionPriceMigration
  extends SubscriptionPriceMigrationStateCompareAndSwapBase {
  readonly expectedStatus: 'previewed';
  readonly expectedExecutionToken: null;
  readonly nextStatus: 'scheduled';
  readonly executionToken: null;
  readonly scheduledAt: Date;
}

export interface StartSubscriptionPriceMigration
  extends SubscriptionPriceMigrationStateCompareAndSwapBase {
  readonly expectedStatus: 'previewed' | 'scheduled' | 'failed';
  readonly expectedExecutionToken: null;
  readonly nextStatus: 'executing';
  readonly executionToken: string;
  readonly scheduledAt?: Date | null;
}

export interface CancelSubscriptionPriceMigration
  extends SubscriptionPriceMigrationStateCompareAndSwapBase {
  readonly expectedStatus: 'previewed' | 'scheduled' | 'failed';
  readonly expectedExecutionToken: null;
  readonly nextStatus: 'cancelled';
  readonly executionToken: null;
  readonly scheduledAt?: Date | null;
}

interface RetainSubscriptionPriceMigrationOwnership<ExecutionToken extends string = string>
  extends SubscriptionPriceMigrationStateCompareAndSwapBase {
  readonly expectedStatus: 'executing';
  readonly expectedExecutionToken: ExecutionToken;
  readonly nextStatus: 'applied' | 'pending_renewal' | 'reconciliation_required';
  readonly executionToken: NoInfer<ExecutionToken>;
  readonly scheduledAt?: Date | null;
}

interface FailSubscriptionPriceMigration extends SubscriptionPriceMigrationStateCompareAndSwapBase {
  readonly expectedStatus: 'executing';
  readonly expectedExecutionToken: string;
  readonly nextStatus: 'failed';
  readonly executionToken: null;
  readonly scheduledAt?: Date | null;
}

export type CompleteSubscriptionPriceMigration<ExecutionToken extends string = string> =
  | RetainSubscriptionPriceMigrationOwnership<ExecutionToken>
  | FailSubscriptionPriceMigration;

export type SubscriptionPriceMigrationStateCompareAndSwap =
  | ScheduleSubscriptionPriceMigration
  | StartSubscriptionPriceMigration
  | CancelSubscriptionPriceMigration
  | CompleteSubscriptionPriceMigration
  | SettleSubscriptionPriceMigration;

export interface SettleSubscriptionPriceMigration
  extends SubscriptionPriceMigrationStateCompareAndSwapBase {
  readonly expectedStatus: 'pending_renewal';
  readonly expectedExecutionToken: string;
  readonly nextStatus: 'applied';
  readonly executionToken: string;
  readonly scheduledAt?: Date | null;
}

interface ResolveSubscriptionPriceMigrationReconciliationBase {
  readonly id: string;
  readonly tenantId: string | null;
  readonly expectedStatus: 'executing' | 'reconciliation_required';
  readonly expectedExecutionToken: string;
  readonly evidenceReference: string;
  readonly reconciliationResolvedAt: Date;
  readonly updatedAt: Date;
}

interface ObserveSubscriptionPriceMigrationReconciliationBase {
  readonly id: string;
  readonly tenantId: string | null;
  readonly expectedExecutionToken: string;
  readonly outcome: 'unknown';
  readonly nextStatus: 'reconciliation_required';
  readonly executionToken: string;
  readonly evidenceReference: string;
  readonly reconciliationObservedAt: Date;
  readonly updatedAt: Date;
}

export type ResolveSubscriptionPriceMigrationReconciliation =
  | (ObserveSubscriptionPriceMigrationReconciliationBase & {
      readonly expectedStatus: 'executing';
      readonly failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN';
      readonly failureMessage: 'Provider outcome is unknown and requires reconciliation';
      readonly appliedAt: null;
      readonly failedAt: null;
    })
  | (ObserveSubscriptionPriceMigrationReconciliationBase & {
      readonly expectedStatus: 'reconciliation_required';
    })
  | (ResolveSubscriptionPriceMigrationReconciliationBase & {
      readonly outcome: 'applied';
      readonly nextStatus: 'applied' | 'pending_renewal';
      readonly executionToken: string;
      readonly failureCode: null;
      readonly failureMessage: null;
      readonly appliedAt: Date | null;
      readonly failedAt: null;
    })
  | (ResolveSubscriptionPriceMigrationReconciliationBase & {
      readonly outcome: 'not_applied';
      readonly nextStatus: 'failed';
      readonly executionToken: null;
      readonly failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED';
      readonly failureMessage: 'Provider did not apply the subscription migration';
      readonly appliedAt: null;
      readonly failedAt: Date;
    });

export interface SubscriptionPriceMigrationReconciliationResult {
  readonly migration: SubscriptionPriceMigration;
  readonly transitionApplied: boolean;
}

declare const subscriptionPriceMigrationExecutionEvidenceBlob: unique symbol;

export type SubscriptionPriceMigrationExecutionEvidenceBlob = string & {
  readonly [subscriptionPriceMigrationExecutionEvidenceBlob]: true;
};

const SUBSCRIPTION_PRICE_MIGRATION_EVIDENCE_PREFIX =
  'payable:subscription-price-migration-evidence:v1:';

export function rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(
  value: string,
): SubscriptionPriceMigrationExecutionEvidenceBlob {
  if (
    !value.startsWith(SUBSCRIPTION_PRICE_MIGRATION_EVIDENCE_PREFIX) ||
    value.length === SUBSCRIPTION_PRICE_MIGRATION_EVIDENCE_PREFIX.length
  ) {
    throw new TypeError('Subscription migration execution evidence has an unsupported version');
  }
  return value as SubscriptionPriceMigrationExecutionEvidenceBlob;
}

export interface SubscriptionPriceMigrationRepository {
  create(data: NewSubscriptionPriceMigration): Promise<SubscriptionPriceMigration>;
  createWithExecutionEvidence(
    data: NewSubscriptionPriceMigration,
    evidence: SubscriptionPriceMigrationExecutionEvidenceBlob,
  ): Promise<SubscriptionPriceMigration>;
  findExecutionEvidenceById(
    id: string,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationExecutionEvidenceBlob | null>;
  findById(id: string, tenantId: string | null): Promise<SubscriptionPriceMigration | null>;
  findActiveBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigration | null>;
  list(
    query: SubscriptionPriceMigrationListQuery,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationListResult>;
  compareAndSwapState<ExecutionToken extends string>(
    input:
      | Exclude<SubscriptionPriceMigrationStateCompareAndSwap, CompleteSubscriptionPriceMigration>
      | CompleteSubscriptionPriceMigration<ExecutionToken>,
  ): Promise<SubscriptionPriceMigration | null>;
  resolveReconciliation(
    input: ResolveSubscriptionPriceMigrationReconciliation,
  ): Promise<SubscriptionPriceMigrationReconciliationResult | null>;
  pageDueScheduled(
    query: SubscriptionPriceMigrationDuePageQuery,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationListResult>;
}
