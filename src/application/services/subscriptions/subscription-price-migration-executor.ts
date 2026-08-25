import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import {
  type SubscriptionPriceMigrationFailureCode,
  subscriptionPriceMigrationFailure,
} from '../../../domain/value-objects/subscription-price-migration-failure';
import { hashRequest } from '../../../support/hash/request-hash';
import type { LocalDependencies } from '../../builders/local-dependencies';
import {
  acquireSubscriptionMutationClaim,
  releaseSubscriptionMutationClaim,
} from './subscription-mutation-claim';
import {
  claimedMigration,
  claimSubscriptionPriceMigration,
  completeSubscriptionPriceMigration,
  reconciliationRequired,
  stateConflict,
} from './subscription-price-migration-claim';
import {
  type PreparedSubscriptionPriceMigrationExecution,
  prepareSubscriptionPriceMigration,
  staleSubscriptionMigration,
} from './subscription-price-migration-preparation';
import {
  type ClaimedPreparedSubscriptionPriceMigration,
  projectSubscriptionPriceMigrationSuccess,
} from './subscription-price-migration-projection';
import { applySubscriptionPriceMigrationProvider } from './subscription-price-migration-provider-outcome';
import { scheduleSubscriptionPriceMigration } from './subscription-price-migration-scheduling';
import { recordSubscriptionPriceMigrationTransition } from './subscription-price-migration-transition';

export class SubscriptionPriceMigrationExecutor {
  constructor(private readonly dependencies: LocalDependencies) {}

  async schedule(id: string): Promise<SubscriptionPriceMigration> {
    return this.storage().transaction(async (repositories) => {
      const migration = await this.requireMigration(repositories, id);
      return scheduleSubscriptionPriceMigration(repositories, migration, this.dependencies);
    });
  }

  async cancel(id: string): Promise<SubscriptionPriceMigration> {
    return this.storage().transaction(async (repositories) => {
      const migration = await this.requireMigration(repositories, id);
      if (migration.status === 'cancelled') return migration;
      if (!['previewed', 'scheduled', 'failed'].includes(migration.status)) {
        this.assertNotReconciliation(migration);
        throw stateConflict(id);
      }
      const now = this.dependencies.clock.now();
      const cancelled = await repositories.subscriptionPriceMigrations.compareAndSwapState({
        id,
        tenantId: this.tenantId(),
        expectedStatus: migration.status as 'previewed' | 'scheduled' | 'failed',
        expectedExecutionToken: null,
        nextStatus: 'cancelled',
        executionToken: null,
        attemptCount: migration.attemptCount,
        failureCode: migration.failureCode,
        failureMessage: migration.failureMessage,
        scheduledAt: migration.scheduledAt,
        executionStartedAt: migration.executionStartedAt,
        appliedAt: null,
        failedAt: migration.failedAt,
        reconciliationRequiredAt: null,
        cancelledAt: now,
        updatedAt: now,
      });
      if (!cancelled) throw stateConflict(id);
      await this.record(repositories, migration, cancelled);
      return cancelled;
    });
  }

  async execute(
    id: string,
    expectedStatus: 'previewed' | 'scheduled' | 'failed',
  ): Promise<SubscriptionPriceMigration> {
    const correlationId = CorrelationId.generate().toString();
    const prepared = await this.storage().transaction(async (repositories) => {
      const migration = await this.requireMigration(repositories, id);
      if (migration.status === 'applied') {
        return { kind: 'applied', migration } as const;
      }
      this.assertNotReconciliation(migration);
      if (migration.status !== expectedStatus) throw stateConflict(id);
      if (expectedStatus === 'previewed') this.assertPreviewFresh(migration);
      if (
        expectedStatus === 'scheduled' &&
        (migration.effectiveTiming !== 'scheduled' ||
          migration.effectiveAt.getTime() > this.dependencies.clock.now().getTime())
      ) {
        throw stateConflict(id);
      }
      const execution = await prepareSubscriptionPriceMigration(
        repositories,
        migration,
        this.dependencies,
      );
      const executionToken = globalThis.crypto.randomUUID();
      await acquireSubscriptionMutationClaim(repositories, {
        claimReference: `subscription-price-migration:${migration.id}:${executionToken}`,
        tenantId: this.tenantId(),
        subscriptionId: migration.subscriptionId,
        ownerToken: executionToken,
        operation: 'subscription_price_migration',
        correlationId,
        intent: null,
        claimedAt: this.dependencies.clock.now(),
      });
      const claimed = await claimSubscriptionPriceMigration(
        repositories,
        migration,
        executionToken,
        this.dependencies.clock.now(),
      );
      await this.record(repositories, migration, claimed, correlationId);
      return { ...execution, kind: 'claimed', migration: claimed } as const;
    });
    if (prepared.kind === 'applied') return prepared.migration;
    if (!claimedMigration(prepared.migration)) throw stateConflict(id);
    return this.callProvider(
      prepared as PreparedSubscriptionPriceMigrationExecution & {
        migration: typeof prepared.migration;
      },
    );
  }

  private async callProvider(
    prepared: PreparedSubscriptionPriceMigrationExecution & {
      migration: SubscriptionPriceMigration & { status: 'executing'; executionToken: string };
    },
  ): Promise<SubscriptionPriceMigration> {
    const context = {
      correlationId: CorrelationId.generate().toString(),
      idempotencyKey: await this.providerKey(prepared),
      tenantId: this.tenantId(),
    };
    let outcome: Awaited<ReturnType<typeof applySubscriptionPriceMigrationProvider>>;
    try {
      outcome = await applySubscriptionPriceMigrationProvider(
        prepared.provider,
        prepared.input,
        context,
      );
    } catch {
      return this.requireReconciliation(
        prepared.migration,
        'SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN',
      );
    }
    if (outcome.kind === 'not_applied') {
      const failure = subscriptionPriceMigrationFailure(
        'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      );
      try {
        await this.finishFailure(prepared.migration, 'failed', failure.code);
      } catch {
        throw reconciliationRequired(prepared.migration.id);
      }
      throw new SubscriptionPriceMigrationError(
        failure.message,
        'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
      );
    }
    if (outcome.subscription.providerSubscriptionId !== prepared.input.providerSubscriptionId) {
      return this.requireReconciliation(
        prepared.migration,
        'SUBSCRIPTION_MIGRATION_PROVIDER_IDENTITY_MISMATCH',
      );
    }
    try {
      return await this.projectSuccess(prepared, outcome.subscription.status);
    } catch {
      return this.requireReconciliation(
        prepared.migration,
        'SUBSCRIPTION_MIGRATION_PROJECTION_FAILED',
      );
    }
  }

  private async requireReconciliation(
    migration: SubscriptionPriceMigration & { status: 'executing'; executionToken: string },
    failureCode: SubscriptionPriceMigrationFailureCode,
  ): Promise<never> {
    try {
      await this.finishFailure(migration, 'reconciliation_required', failureCode);
    } catch {}
    throw reconciliationRequired(migration.id);
  }

  private async projectSuccess(
    prepared: ClaimedPreparedSubscriptionPriceMigration,
    providerStatus: Parameters<typeof projectSubscriptionPriceMigrationSuccess>[2],
  ): Promise<SubscriptionPriceMigration> {
    return this.storage().transaction((repositories) =>
      projectSubscriptionPriceMigrationSuccess(
        repositories,
        prepared,
        providerStatus,
        this.tenantId(),
        this.dependencies.clock.now(),
      ),
    );
  }

  private async finishFailure(
    migration: SubscriptionPriceMigration & { status: 'executing'; executionToken: string },
    status: 'failed' | 'reconciliation_required',
    failureCode: SubscriptionPriceMigrationFailureCode,
  ): Promise<void> {
    await this.storage().transaction(async (repositories) => {
      const completed = await completeSubscriptionPriceMigration(
        repositories,
        migration,
        { status, failureCode },
        this.dependencies.clock.now(),
      );
      if (status === 'failed') {
        await releaseSubscriptionMutationClaim(repositories, {
          tenantId: this.tenantId(),
          subscriptionId: migration.subscriptionId,
          ownerToken: migration.executionToken,
        });
      }
      await this.record(repositories, migration, completed);
    });
  }

  private async record(
    repositories: Repositories,
    before: SubscriptionPriceMigration,
    after: SubscriptionPriceMigration,
    correlationId = CorrelationId.generate().toString(),
  ): Promise<void> {
    await recordSubscriptionPriceMigrationTransition(
      repositories,
      before,
      after,
      correlationId,
      this.dependencies.clock.now(),
    );
  }

  private async providerKey(
    prepared: PreparedSubscriptionPriceMigrationExecution,
  ): Promise<string> {
    return `payable:subscription-price-migration-execute:v1:${await hashRequest([
      this.tenantId(),
      prepared.providerKey,
      prepared.migration.providerBindingId,
      prepared.migration.id,
      prepared.migration.attemptCount,
    ])}`;
  }

  private async requireMigration(repositories: Repositories, id: string) {
    const migration = await repositories.subscriptionPriceMigrations.findById(id, this.tenantId());
    if (!migration)
      throw new SubscriptionPriceMigrationError(
        `Subscription migration not found: ${id}`,
        'SUBSCRIPTION_MIGRATION_NOT_FOUND',
      );
    return migration;
  }

  private assertPreviewFresh(migration: SubscriptionPriceMigration): void {
    if (migration.expiresAt.getTime() <= this.dependencies.clock.now().getTime()) {
      throw staleSubscriptionMigration(migration.id);
    }
  }

  private assertNotReconciliation(migration: SubscriptionPriceMigration): void {
    if (migration.status === 'reconciliation_required') {
      throw reconciliationRequired(migration.id);
    }
  }

  private storage() {
    if (!this.dependencies.storage)
      throw new SubscriptionPriceMigrationError(
        'Subscription migrations require canonical storage',
        'SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED',
      );
    return this.dependencies.storage;
  }

  private tenantId(): string | null {
    return this.dependencies.tenantId ?? null;
  }
}
