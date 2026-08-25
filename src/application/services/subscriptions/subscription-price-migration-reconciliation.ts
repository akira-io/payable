import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { LocalDependencies } from '../../builders/local-dependencies';
import type { ResolveSubscriptionPriceMigrationInput } from '../../builders/subscription-price-migration-resource.contract';
import { releaseSubscriptionMutationClaim } from './subscription-mutation-claim';
import { stateConflict } from './subscription-price-migration-claim';
import { assertSubscriptionMigrationCanonicalSource } from './subscription-price-migration-preparation';
import { projectApprovedSubscriptionPriceMigration } from './subscription-price-migration-projection';
import { recordSubscriptionPriceMigrationTransition } from './subscription-price-migration-transition';

export async function resolveSubscriptionPriceMigrationReconciliation(
  repositories: Repositories,
  dependencies: LocalDependencies,
  id: string,
  input: ResolveSubscriptionPriceMigrationInput,
): Promise<SubscriptionPriceMigration> {
  const tenantId = dependencies.tenantId ?? null;
  const migration = await repositories.subscriptionPriceMigrations.findById(id, tenantId);
  if (!migration) throw notFound(id);
  if (input.outcome === 'unknown') {
    if (
      migration.status === 'reconciliation_required' &&
      migration.reconciliationObservationEvidenceReference === input.evidenceReference
    ) {
      return migration;
    }
    if (
      (migration.status !== 'executing' && migration.status !== 'reconciliation_required') ||
      migration.executionToken === null ||
      migration.reconciliationObservationEvidenceReference !== null
    ) {
      throw stateConflict(id);
    }
    const now = dependencies.clock.now();
    const observation = {
      id: migration.id,
      tenantId,
      expectedExecutionToken: migration.executionToken,
      outcome: 'unknown',
      nextStatus: 'reconciliation_required',
      executionToken: migration.executionToken,
      evidenceReference: input.evidenceReference,
      reconciliationObservedAt: now,
      updatedAt: now,
    } as const;
    const result = await repositories.subscriptionPriceMigrations.resolveReconciliation(
      migration.status === 'executing'
        ? {
            ...observation,
            expectedStatus: 'executing',
            failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_OUTCOME_UNKNOWN',
            failureMessage: 'Provider outcome is unknown and requires reconciliation',
            appliedAt: null,
            failedAt: null,
          }
        : { ...observation, expectedStatus: 'reconciliation_required' },
    );
    if (!result) throw stateConflict(id);
    if (result.transitionApplied) {
      await recordSubscriptionPriceMigrationTransition(
        repositories,
        migration,
        result.migration,
        CorrelationId.generate().toString(),
        now,
        'observation',
      );
    }
    return result.migration;
  }
  if (migration.reconciliationOutcome !== null) {
    if (
      migration.reconciliationOutcome === input.outcome &&
      migration.reconciliationEvidenceReference === input.evidenceReference
    ) {
      return migration;
    }
    throw stateConflict(id);
  }
  if (
    (migration.status !== 'reconciliation_required' && migration.status !== 'executing') ||
    migration.executionToken === null
  ) {
    throw stateConflict(id);
  }
  const executionToken = migration.executionToken;
  const now = dependencies.clock.now();
  const pendingRenewal = input.outcome === 'applied' && migration.effectiveTiming === 'nextRenewal';
  if (input.outcome === 'applied' && !pendingRenewal) {
    const subscription = await assertSubscriptionMigrationCanonicalSource(
      repositories,
      migration,
      tenantId,
    );
    await projectApprovedSubscriptionPriceMigration(
      repositories,
      migration,
      subscription,
      subscription.status,
      tenantId,
    );
  }
  const result = await repositories.subscriptionPriceMigrations.resolveReconciliation(
    input.outcome === 'applied'
      ? appliedResolution(migration, executionToken, input.evidenceReference, now, pendingRenewal)
      : notAppliedResolution(migration, executionToken, input.evidenceReference, now),
  );
  if (!result) throw stateConflict(id);
  if (!pendingRenewal) {
    await releaseSubscriptionMutationClaim(repositories, {
      tenantId,
      subscriptionId: migration.subscriptionId,
      ownerToken: executionToken,
    });
  }
  if (result.transitionApplied) {
    await recordSubscriptionPriceMigrationTransition(
      repositories,
      migration,
      result.migration,
      CorrelationId.generate().toString(),
      now,
    );
  }
  return result.migration;
}

function appliedResolution(
  migration: SubscriptionPriceMigration,
  executionToken: string,
  evidenceReference: string,
  now: Date,
  pendingRenewal: boolean,
) {
  return {
    ...resolutionBase(migration, executionToken, evidenceReference, now),
    outcome: 'applied' as const,
    nextStatus: pendingRenewal ? ('pending_renewal' as const) : ('applied' as const),
    executionToken,
    failureCode: null,
    failureMessage: null,
    appliedAt: pendingRenewal ? null : now,
    failedAt: null,
  };
}

function notAppliedResolution(
  migration: SubscriptionPriceMigration,
  executionToken: string,
  evidenceReference: string,
  now: Date,
) {
  return {
    ...resolutionBase(migration, executionToken, evidenceReference, now),
    outcome: 'not_applied' as const,
    nextStatus: 'failed' as const,
    executionToken: null,
    failureCode: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED' as const,
    failureMessage: 'Provider did not apply the subscription migration' as const,
    appliedAt: null,
    failedAt: now,
  };
}

function resolutionBase(
  migration: SubscriptionPriceMigration,
  executionToken: string,
  evidenceReference: string,
  now: Date,
) {
  return {
    id: migration.id,
    tenantId: migration.tenantId,
    expectedStatus: migration.status as 'executing' | 'reconciliation_required',
    expectedExecutionToken: executionToken,
    evidenceReference,
    reconciliationResolvedAt: now,
    updatedAt: now,
  };
}

function notFound(id: string): SubscriptionPriceMigrationError {
  return new SubscriptionPriceMigrationError(
    `Subscription migration not found: ${id}`,
    'SUBSCRIPTION_MIGRATION_NOT_FOUND',
  );
}
