import type { Knex } from 'knex';
import type { ResolveSubscriptionPriceMigrationReconciliation } from '../../../../domain/contracts';
import { fromDate } from '../mappers';

export async function updateSubscriptionPriceMigrationReconciliation(
  knex: Knex,
  table: string,
  input: ResolveSubscriptionPriceMigrationReconciliation,
): Promise<number> {
  if (input.outcome === 'unknown' && input.executionToken !== input.expectedExecutionToken) {
    return 0;
  }
  let query = knex(table).where({
    id: input.id,
    tenant_key: input.tenantId ?? '',
    status: input.expectedStatus,
    execution_token: input.expectedExecutionToken,
  });
  if (input.outcome === 'unknown') {
    query = query
      .whereNull('reconciliation_observation_evidence_reference')
      .whereNull('reconciliation_observed_at');
  }
  return query.update(
    input.outcome === 'unknown'
      ? input.expectedStatus === 'executing'
        ? {
            status: input.nextStatus,
            active_subscription_id: knex.ref('subscription_id'),
            execution_token: input.executionToken,
            failure_code: input.failureCode,
            failure_message: input.failureMessage,
            reconciliation_required_at: input.reconciliationObservedAt.toISOString(),
            reconciliation_observation_evidence_reference: input.evidenceReference,
            reconciliation_observed_at: input.reconciliationObservedAt.toISOString(),
            updated_at: input.updatedAt.toISOString(),
          }
        : {
            reconciliation_observation_evidence_reference: input.evidenceReference,
            reconciliation_observed_at: input.reconciliationObservedAt.toISOString(),
            updated_at: input.updatedAt.toISOString(),
          }
      : {
          status: input.nextStatus,
          active_subscription_id:
            input.nextStatus === 'pending_renewal' ? knex.ref('subscription_id') : null,
          execution_token: input.executionToken,
          failure_code: input.failureCode,
          failure_message: input.failureMessage,
          applied_at: fromDate(input.appliedAt),
          failed_at: fromDate(input.failedAt),
          reconciliation_outcome: input.outcome,
          reconciliation_evidence_reference: input.evidenceReference,
          reconciliation_resolved_at: input.reconciliationResolvedAt.toISOString(),
          updated_at: input.updatedAt.toISOString(),
        },
  );
}
