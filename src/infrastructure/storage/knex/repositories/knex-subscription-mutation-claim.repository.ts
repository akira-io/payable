import type { Knex } from 'knex';
import type {
  AcquireSubscriptionMutationClaim,
  ObserveSubscriptionMutationClaim,
  ReleaseSubscriptionMutationClaim,
  ResolveSubscriptionMutationClaim,
  SubscriptionMutationClaim,
  SubscriptionMutationClaimRepository,
} from '../../../../domain/contracts/subscription-mutation-claim-repository.contract';
import {
  type StoredSubscriptionMutationClaimRow,
  subscriptionMutationClaimToEntity,
} from '../../mappers/subscription-mutation-claim.mapper';
import { toDate, toNullableDate } from '../mappers';
import { isUniqueViolation } from '../unique-violation';

export class KnexSubscriptionMutationClaimRepository
  implements SubscriptionMutationClaimRepository
{
  private readonly table = 'payable_subscription_mutation_claims';

  constructor(private readonly knex: Knex) {}

  async acquire(input: AcquireSubscriptionMutationClaim): Promise<boolean> {
    try {
      await this.knex(this.table).insert({
        claim_reference: input.claimReference,
        tenant_key: input.tenantId ?? '',
        subscription_id: input.subscriptionId,
        active_subscription_id: input.subscriptionId,
        owner_token: input.ownerToken,
        operation: input.operation,
        correlation_id: input.correlationId,
        intent: input.intent,
        status: 'active',
        resolution_outcome: null,
        resolution_evidence_reference: null,
        resolved_at: null,
        observation_outcome: null,
        observation_evidence_reference: null,
        observed_at: null,
        claimed_at: input.claimedAt.toISOString(),
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async release(input: ReleaseSubscriptionMutationClaim): Promise<boolean> {
    const affected = await this.knex(this.table)
      .where({
        tenant_key: input.tenantId ?? '',
        subscription_id: input.subscriptionId,
        owner_token: input.ownerToken,
        status: 'active',
      })
      .delete();
    return affected === 1;
  }

  async findByReference(
    claimReference: string,
    tenantId: string | null,
  ): Promise<SubscriptionMutationClaim | null> {
    const row = (await this.knex(this.table)
      .where({ claim_reference: claimReference, tenant_key: tenantId ?? '' })
      .first()) as Record<string, unknown> | undefined;
    return row ? subscriptionMutationClaimToEntity(toStoredRow(row)) : null;
  }

  async findActiveBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionMutationClaim | null> {
    const row = (await this.knex(this.table)
      .where({
        tenant_key: tenantId ?? '',
        active_subscription_id: subscriptionId,
        status: 'active',
      })
      .first()) as Record<string, unknown> | undefined;
    return row ? subscriptionMutationClaimToEntity(toStoredRow(row)) : null;
  }

  async observe(
    input: ObserveSubscriptionMutationClaim,
  ): Promise<SubscriptionMutationClaim | null> {
    const affected = await this.knex(this.table)
      .where({
        claim_reference: input.claimReference,
        tenant_key: input.tenantId ?? '',
        owner_token: input.expectedOwnerToken,
        status: 'active',
      })
      .whereNull('observation_outcome')
      .whereNull('observation_evidence_reference')
      .whereNull('observed_at')
      .update({
        observation_outcome: input.outcome,
        observation_evidence_reference: input.evidenceReference,
        observed_at: input.observedAt.toISOString(),
      });
    const claim = await this.findByReference(input.claimReference, input.tenantId);
    if (affected === 1) return claim;
    return claim?.status === 'active' &&
      claim.ownerToken === input.expectedOwnerToken &&
      claim.observationOutcome === input.outcome &&
      claim.observationEvidenceReference === input.evidenceReference
      ? claim
      : null;
  }

  async resolve(
    input: ResolveSubscriptionMutationClaim,
  ): Promise<SubscriptionMutationClaim | null> {
    const affected = await this.knex(this.table)
      .where({
        claim_reference: input.claimReference,
        tenant_key: input.tenantId ?? '',
        owner_token: input.expectedOwnerToken,
        status: 'active',
      })
      .update({
        active_subscription_id: null,
        status: 'resolved',
        resolution_outcome: input.outcome,
        resolution_evidence_reference: input.evidenceReference,
        resolved_at: input.resolvedAt.toISOString(),
      });
    return affected === 0 ? null : this.findByReference(input.claimReference, input.tenantId);
  }
}

function toStoredRow(row: Record<string, unknown>): StoredSubscriptionMutationClaimRow {
  return {
    claimReference: row.claim_reference as string,
    tenantKey: row.tenant_key as string,
    subscriptionId: row.subscription_id as string,
    ownerToken: row.owner_token as string,
    operation: row.operation as string,
    correlationId: row.correlation_id as string,
    intent: (row.intent as string | null) ?? null,
    status: row.status as string,
    resolutionOutcome: (row.resolution_outcome as string | null) ?? null,
    resolutionEvidenceReference: (row.resolution_evidence_reference as string | null) ?? null,
    resolvedAt: toNullableDate(row.resolved_at),
    observationOutcome: (row.observation_outcome as string | null) ?? null,
    observationEvidenceReference: (row.observation_evidence_reference as string | null) ?? null,
    observedAt: toNullableDate(row.observed_at),
    claimedAt: toDate(row.claimed_at),
  };
}
