import type { Knex } from 'knex';
import type {
  CompleteSubscriptionPriceMigration,
  NewSubscriptionPriceMigration,
  ResolveSubscriptionPriceMigrationReconciliation,
  SubscriptionPriceMigrationDuePageQuery,
  SubscriptionPriceMigrationExecutionEvidenceBlob,
  SubscriptionPriceMigrationListQuery,
  SubscriptionPriceMigrationListResult,
  SubscriptionPriceMigrationReconciliationResult,
  SubscriptionPriceMigrationRepository,
  SubscriptionPriceMigrationStateCompareAndSwap,
} from '../../../../domain/contracts';
import { rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob } from '../../../../domain/contracts';
import type { Clock } from '../../../../domain/contracts/clock.contract';
import type { SubscriptionPriceMigration } from '../../../../domain/entities';
import {
  type StoredSubscriptionPriceMigrationRow,
  subscriptionPriceMigrationToEntity,
  subscriptionPriceMigrationToStorageValues,
} from '../../mappers/subscription-price-migration.mapper';
import { isValidSubscriptionPriceMigrationCas } from '../../subscription-price-migration-cas';
import { fromDate, stripUndefined, toDate, toNullableDate } from '../mappers';
import { subscriptionPriceMigrationCreateRow } from '../mappers/subscription-price-migration-row';
import { isUniqueViolation } from '../unique-violation';
import { updateSubscriptionPriceMigrationReconciliation } from './knex-subscription-price-migration-reconciliation';

export class KnexSubscriptionPriceMigrationRepository
  implements SubscriptionPriceMigrationRepository
{
  private readonly table = 'payable_subscription_price_migrations';

  constructor(
    private readonly knex: Knex,
    private readonly clock: Clock,
  ) {}

  async create(data: NewSubscriptionPriceMigration): Promise<SubscriptionPriceMigration> {
    return this.insert(data, null);
  }

  async createWithExecutionEvidence(
    data: NewSubscriptionPriceMigration,
    evidence: SubscriptionPriceMigrationExecutionEvidenceBlob,
  ): Promise<SubscriptionPriceMigration> {
    return this.insert(data, evidence);
  }

  async findExecutionEvidenceById(
    id: string,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationExecutionEvidenceBlob | null> {
    const row = (await this.knex(this.table)
      .where({ id, tenant_key: tenantId ?? '' })
      .first()) as Record<string, unknown> | undefined;
    if (!row) return null;
    const evidence = (row.provider_evidence as string | null) ?? null;
    return evidence === null
      ? null
      : rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(evidence);
  }

  private async insert(
    data: NewSubscriptionPriceMigration,
    providerEvidence: SubscriptionPriceMigrationExecutionEvidenceBlob | null,
  ): Promise<SubscriptionPriceMigration> {
    const values = subscriptionPriceMigrationToStorageValues(data);
    const id = globalThis.crypto.randomUUID();
    const timestamp = this.clock.now().toISOString();
    const [inserted] = await this.knex(this.table)
      .insert({
        id,
        ...subscriptionPriceMigrationCreateRow({ ...values, providerEvidence }),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning('*');
    if (inserted) return this.toEntity(inserted as Record<string, unknown>);
    const created = await this.findById(id, data.tenantId);
    if (!created) throw new Error(`${this.table}: row ${id} missing after create`);
    return created;
  }

  async findById(id: string, tenantId: string | null): Promise<SubscriptionPriceMigration | null> {
    const row = (await this.knex(this.table)
      .where({ id, tenant_key: tenantId ?? '' })
      .first()) as Record<string, unknown> | undefined;
    return row ? this.toEntity(row) : null;
  }

  async findActiveBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigration | null> {
    const row = (await this.knex(this.table)
      .where({ tenant_key: tenantId ?? '', active_subscription_id: subscriptionId })
      .first()) as Record<string, unknown> | undefined;
    return row ? this.toEntity(row) : null;
  }

  async list(
    query: SubscriptionPriceMigrationListQuery,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationListResult> {
    let rowsQuery = this.knex(this.table)
      .where({ tenant_key: tenantId ?? '' })
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');
    if (query.id) rowsQuery = rowsQuery.where({ id: query.id });
    if (query.subscriptionId) {
      rowsQuery = rowsQuery.where({ subscription_id: query.subscriptionId });
    }
    if (query.status) rowsQuery = rowsQuery.where({ status: query.status });
    if (query.before) {
      const createdAt = query.before.createdAt.toISOString();
      rowsQuery = rowsQuery.where((row) =>
        row
          .where('created_at', '<', createdAt)
          .orWhere((tie) =>
            tie.where('created_at', createdAt).andWhere('id', '<', query.before?.id ?? ''),
          ),
      );
    }
    return this.toPage(
      (await rowsQuery.limit(query.limit + 1)) as Record<string, unknown>[],
      query.limit,
    );
  }

  async compareAndSwapState<ExecutionToken extends string>(
    input:
      | Exclude<SubscriptionPriceMigrationStateCompareAndSwap, CompleteSubscriptionPriceMigration>
      | CompleteSubscriptionPriceMigration<ExecutionToken>,
  ): Promise<SubscriptionPriceMigration | null> {
    if (!isValidSubscriptionPriceMigrationCas(input)) return null;
    let query = this.knex(this.table).where({
      id: input.id,
      tenant_key: input.tenantId ?? '',
      status: input.expectedStatus,
    });
    query =
      input.expectedExecutionToken === null
        ? query.whereNull('execution_token')
        : query.where({ execution_token: input.expectedExecutionToken });
    let affected: number;
    try {
      affected = await query.update(
        stripUndefined({
          status: input.nextStatus,
          active_subscription_id:
            input.nextStatus === 'applied' || input.nextStatus === 'cancelled'
              ? null
              : input.nextStatus === 'executing'
                ? this.knex.ref('subscription_id')
                : undefined,
          execution_token: input.executionToken,
          attempt_count: input.attemptCount,
          failure_code: input.failureCode,
          failure_message: input.failureMessage,
          scheduled_at: fromDate(input.scheduledAt),
          execution_started_at: fromDate(input.executionStartedAt),
          applied_at: fromDate(input.appliedAt),
          failed_at: fromDate(input.failedAt),
          reconciliation_required_at: fromDate(input.reconciliationRequiredAt),
          cancelled_at: fromDate(input.cancelledAt),
          updated_at: input.updatedAt.toISOString(),
        }),
      );
    } catch (error) {
      if (input.nextStatus === 'executing' && isUniqueViolation(error)) return null;
      throw error;
    }
    return affected === 0 ? null : this.findById(input.id, input.tenantId);
  }

  async resolveReconciliation(
    input: ResolveSubscriptionPriceMigrationReconciliation,
  ): Promise<SubscriptionPriceMigrationReconciliationResult | null> {
    const affected = await updateSubscriptionPriceMigrationReconciliation(
      this.knex,
      this.table,
      input,
    );
    const migration = await this.findById(input.id, input.tenantId);
    if (!migration) return null;
    if (affected === 1) return { migration, transitionApplied: true };
    const exactReplay =
      input.outcome === 'unknown' &&
      input.executionToken === input.expectedExecutionToken &&
      migration.status === 'reconciliation_required' &&
      migration.executionToken === input.expectedExecutionToken &&
      migration.reconciliationObservationEvidenceReference === input.evidenceReference;
    return exactReplay ? { migration, transitionApplied: false } : null;
  }

  async pageDueScheduled(
    query: SubscriptionPriceMigrationDuePageQuery,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationListResult> {
    let rowsQuery = this.knex(this.table)
      .where({ tenant_key: tenantId ?? '', status: 'scheduled' })
      .where('effective_at', '<=', query.dueBefore.toISOString())
      .orderBy('effective_at', 'asc')
      .orderBy('id', 'asc');
    if (query.before) {
      const effectiveAt = query.before.effectiveAt.toISOString();
      rowsQuery = rowsQuery.where((row) =>
        row
          .where('effective_at', '>', effectiveAt)
          .orWhere((tie) =>
            tie.where('effective_at', effectiveAt).andWhere('id', '>', query.before?.id ?? ''),
          ),
      );
    }
    return this.toPage(
      (await rowsQuery.limit(query.limit + 1)) as Record<string, unknown>[],
      query.limit,
    );
  }

  private toPage(
    rows: Record<string, unknown>[],
    limit: number,
  ): SubscriptionPriceMigrationListResult {
    return {
      items: rows.slice(0, limit).map((row) => this.toEntity(row)),
      hasMore: rows.length > limit,
    };
  }

  private toEntity(row: Record<string, unknown>): SubscriptionPriceMigration {
    return subscriptionPriceMigrationToEntity({
      id: row.id as string,
      tenantKey: row.tenant_key as string,
      subscriptionId: row.subscription_id as string,
      primaryItemId: row.primary_item_id as string,
      activeSubscriptionId: (row.active_subscription_id as string | null) ?? null,
      sourcePriceId: row.source_price_id as string,
      targetPriceId: row.target_price_id as string,
      sourcePrice: row.source_price as string,
      targetPrice: row.target_price as string,
      currentItems: row.current_items as string,
      proposedItems: row.proposed_items as string,
      effectiveTiming: row.effective_timing as string,
      effectiveAt: toNullableDate(row.effective_at),
      prorationPolicy: row.proration_policy as string,
      paymentFailurePolicy: row.payment_failure_policy as string,
      immediateAdjustment: row.immediate_adjustment as string,
      nextRenewal: row.next_renewal as string,
      currentRenewalDate: toNullableDate(row.current_renewal_date),
      warnings: row.warnings as string,
      providerLimitations: row.provider_limitations as string,
      providerEvidence: (row.provider_evidence as string | null) ?? null,
      previewToken: row.preview_token as string,
      requestHash: row.request_hash as string,
      calculatedAt: toDate(row.calculated_at),
      expiresAt: toDate(row.expires_at),
      providerBindingId: row.provider_binding_id as string,
      status: row.status as string,
      attemptCount: Number(row.attempt_count),
      executionToken: (row.execution_token as string | null) ?? null,
      failureCode: (row.failure_code as string | null) ?? null,
      failureMessage: (row.failure_message as string | null) ?? null,
      scheduledAt: toNullableDate(row.scheduled_at),
      executionStartedAt: toNullableDate(row.execution_started_at),
      appliedAt: toNullableDate(row.applied_at),
      failedAt: toNullableDate(row.failed_at),
      reconciliationRequiredAt: toNullableDate(row.reconciliation_required_at),
      reconciliationOutcome: (row.reconciliation_outcome as string | null) ?? null,
      reconciliationEvidenceReference:
        (row.reconciliation_evidence_reference as string | null) ?? null,
      reconciliationResolvedAt: toNullableDate(row.reconciliation_resolved_at),
      reconciliationObservationEvidenceReference:
        (row.reconciliation_observation_evidence_reference as string | null) ?? null,
      reconciliationObservedAt: toNullableDate(row.reconciliation_observed_at),
      cancelledAt: toNullableDate(row.cancelled_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    } satisfies StoredSubscriptionPriceMigrationRow);
  }
}
