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
import type { PrismaClient, PrismaDelegate } from '../prisma-client.types';
import { isPrismaUniqueViolation } from '../unique-violation';

export class PrismaSubscriptionPriceMigrationRepository
  implements SubscriptionPriceMigrationRepository
{
  private readonly delegate: PrismaDelegate<StoredSubscriptionPriceMigrationRow>;

  constructor(
    client: PrismaClient,
    private readonly clock: Clock,
  ) {
    this.delegate = client.payableSubscriptionPriceMigration;
  }

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
    const row = await this.delegate.findFirst({ where: { id, tenantKey: tenantId ?? '' } });
    if (!row) return null;
    return row.providerEvidence === null
      ? null
      : rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(row.providerEvidence);
  }

  private async insert(
    data: NewSubscriptionPriceMigration,
    providerEvidence: SubscriptionPriceMigrationExecutionEvidenceBlob | null,
  ): Promise<SubscriptionPriceMigration> {
    const values = subscriptionPriceMigrationToStorageValues(data);
    const now = this.clock.now();
    const row = await this.delegate.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        ...values,
        providerEvidence,
        createdAt: now,
        updatedAt: now,
      },
    });
    return subscriptionPriceMigrationToEntity(row);
  }

  async findById(id: string, tenantId: string | null): Promise<SubscriptionPriceMigration | null> {
    const row = await this.delegate.findFirst({ where: { id, tenantKey: tenantId ?? '' } });
    return row ? subscriptionPriceMigrationToEntity(row) : null;
  }

  async findActiveBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigration | null> {
    const row = await this.delegate.findFirst({
      where: { tenantKey: tenantId ?? '', activeSubscriptionId: subscriptionId },
    });
    return row ? subscriptionPriceMigrationToEntity(row) : null;
  }

  async list(
    query: SubscriptionPriceMigrationListQuery,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationListResult> {
    const filters: Record<string, unknown>[] = [
      { tenantKey: tenantId ?? '' },
      query.id ? { id: query.id } : {},
      query.subscriptionId ? { subscriptionId: query.subscriptionId } : {},
      query.status ? { status: query.status } : {},
    ];
    if (query.before) {
      filters.push({
        OR: [
          { createdAt: { lt: query.before.createdAt } },
          { createdAt: query.before.createdAt, id: { lt: query.before.id } },
        ],
      });
    }
    const rows = await this.delegate.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.toPage(rows, query.limit);
  }

  async compareAndSwapState<ExecutionToken extends string>(
    input:
      | Exclude<SubscriptionPriceMigrationStateCompareAndSwap, CompleteSubscriptionPriceMigration>
      | CompleteSubscriptionPriceMigration<ExecutionToken>,
  ): Promise<SubscriptionPriceMigration | null> {
    if (!isValidSubscriptionPriceMigrationCas(input)) return null;
    const current =
      input.nextStatus === 'executing'
        ? await this.delegate.findFirst({
            where: {
              id: input.id,
              tenantKey: input.tenantId ?? '',
              status: input.expectedStatus,
              executionToken: input.expectedExecutionToken,
            },
          })
        : null;
    if (input.nextStatus === 'executing' && !current) return null;
    let result: { count: number };
    try {
      result = await this.delegate.updateMany({
        where: {
          id: input.id,
          tenantKey: input.tenantId ?? '',
          status: input.expectedStatus,
          executionToken: input.expectedExecutionToken,
        },
        data: {
          status: input.nextStatus,
          activeSubscriptionId:
            input.nextStatus === 'applied' || input.nextStatus === 'cancelled'
              ? null
              : input.nextStatus === 'executing'
                ? current?.subscriptionId
                : undefined,
          executionToken: input.executionToken,
          attemptCount: input.attemptCount,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
          scheduledAt: input.scheduledAt,
          executionStartedAt: input.executionStartedAt,
          appliedAt: input.appliedAt,
          failedAt: input.failedAt,
          reconciliationRequiredAt: input.reconciliationRequiredAt,
          cancelledAt: input.cancelledAt,
          updatedAt: input.updatedAt,
        },
      });
    } catch (error) {
      if (input.nextStatus === 'executing' && isPrismaUniqueViolation(error)) return null;
      throw error;
    }
    return result.count === 0 ? null : this.findById(input.id, input.tenantId);
  }

  async resolveReconciliation(
    input: ResolveSubscriptionPriceMigrationReconciliation,
  ): Promise<SubscriptionPriceMigrationReconciliationResult | null> {
    if (input.outcome === 'unknown' && input.executionToken !== input.expectedExecutionToken) {
      return null;
    }
    const result = await this.delegate.updateMany({
      where: {
        id: input.id,
        tenantKey: input.tenantId ?? '',
        status: input.expectedStatus,
        executionToken: input.expectedExecutionToken,
        ...(input.outcome === 'unknown'
          ? {
              reconciliationObservationEvidenceReference: null,
              reconciliationObservedAt: null,
            }
          : {}),
      },
      data:
        input.outcome === 'unknown'
          ? input.expectedStatus === 'executing'
            ? {
                status: input.nextStatus,
                activeSubscriptionId: undefined,
                executionToken: input.executionToken,
                failureCode: input.failureCode,
                failureMessage: input.failureMessage,
                reconciliationRequiredAt: input.reconciliationObservedAt,
                reconciliationObservationEvidenceReference: input.evidenceReference,
                reconciliationObservedAt: input.reconciliationObservedAt,
                updatedAt: input.updatedAt,
              }
            : {
                reconciliationObservationEvidenceReference: input.evidenceReference,
                reconciliationObservedAt: input.reconciliationObservedAt,
                updatedAt: input.updatedAt,
              }
          : {
              status: input.nextStatus,
              activeSubscriptionId: input.nextStatus === 'pending_renewal' ? undefined : null,
              executionToken: input.executionToken,
              failureCode: input.failureCode,
              failureMessage: input.failureMessage,
              appliedAt: input.appliedAt,
              failedAt: input.failedAt,
              reconciliationOutcome: input.outcome,
              reconciliationEvidenceReference: input.evidenceReference,
              reconciliationResolvedAt: input.reconciliationResolvedAt,
              updatedAt: input.updatedAt,
            },
    });
    const migration = await this.findById(input.id, input.tenantId);
    if (!migration) return null;
    if (result.count === 1) return { migration, transitionApplied: true };
    const exactReplay =
      input.outcome === 'unknown' &&
      migration.status === 'reconciliation_required' &&
      migration.executionToken === input.expectedExecutionToken &&
      migration.reconciliationObservationEvidenceReference === input.evidenceReference;
    return exactReplay ? { migration, transitionApplied: false } : null;
  }

  async pageDueScheduled(
    query: SubscriptionPriceMigrationDuePageQuery,
    tenantId: string | null,
  ): Promise<SubscriptionPriceMigrationListResult> {
    const filters: Record<string, unknown>[] = [
      { tenantKey: tenantId ?? '', status: 'scheduled', effectiveAt: { lte: query.dueBefore } },
    ];
    if (query.before) {
      filters.push({
        OR: [
          { effectiveAt: { gt: query.before.effectiveAt } },
          { effectiveAt: query.before.effectiveAt, id: { gt: query.before.id } },
        ],
      });
    }
    const rows = await this.delegate.findMany({
      where: { AND: filters },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    return this.toPage(rows, query.limit);
  }

  private toPage(
    rows: StoredSubscriptionPriceMigrationRow[],
    limit: number,
  ): SubscriptionPriceMigrationListResult {
    return {
      items: rows.slice(0, limit).map(subscriptionPriceMigrationToEntity),
      hasMore: rows.length > limit,
    };
  }
}
