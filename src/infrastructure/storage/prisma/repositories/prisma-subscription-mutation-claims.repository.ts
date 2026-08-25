import type {
  AcquireSubscriptionMutationClaim,
  ObserveSubscriptionMutationClaim,
  ReleaseSubscriptionMutationClaim,
  ResolveSubscriptionMutationClaim,
  SubscriptionMutationClaim,
  SubscriptionMutationClaimRepository,
} from '../../../../domain/contracts/subscription-mutation-claim-repository.contract';
import { subscriptionMutationClaimToEntity } from '../../mappers/subscription-mutation-claim.mapper';
import type {
  PrismaClient,
  PrismaDelegate,
  PrismaSubscriptionMutationClaimRow,
} from '../prisma-client.types';
import { isPrismaUniqueViolation } from '../unique-violation';

export class PrismaSubscriptionMutationClaimRepository
  implements SubscriptionMutationClaimRepository
{
  private readonly delegate: PrismaDelegate<PrismaSubscriptionMutationClaimRow>;

  constructor(client: PrismaClient) {
    this.delegate = client.payableSubscriptionMutationClaim;
  }

  async acquire(input: AcquireSubscriptionMutationClaim): Promise<boolean> {
    try {
      await this.delegate.create({
        data: {
          claimReference: input.claimReference,
          tenantKey: input.tenantId ?? '',
          subscriptionId: input.subscriptionId,
          activeSubscriptionId: input.subscriptionId,
          ownerToken: input.ownerToken,
          operation: input.operation,
          correlationId: input.correlationId,
          intent: input.intent,
          status: 'active',
          resolutionOutcome: null,
          resolutionEvidenceReference: null,
          resolvedAt: null,
          observationOutcome: null,
          observationEvidenceReference: null,
          observedAt: null,
          claimedAt: input.claimedAt,
        },
      });
      return true;
    } catch (error) {
      if (isPrismaUniqueViolation(error)) return false;
      throw error;
    }
  }

  async findActiveBySubscriptionId(
    subscriptionId: string,
    tenantId: string | null,
  ): Promise<SubscriptionMutationClaim | null> {
    const row = await this.delegate.findFirst({
      where: {
        tenantKey: tenantId ?? '',
        activeSubscriptionId: subscriptionId,
        status: 'active',
      },
    });
    return row ? subscriptionMutationClaimToEntity(row) : null;
  }

  async observe(
    input: ObserveSubscriptionMutationClaim,
  ): Promise<SubscriptionMutationClaim | null> {
    const result = await this.delegate.updateMany({
      where: {
        claimReference: input.claimReference,
        tenantKey: input.tenantId ?? '',
        ownerToken: input.expectedOwnerToken,
        status: 'active',
        observationOutcome: null,
        observationEvidenceReference: null,
        observedAt: null,
      },
      data: {
        observationOutcome: input.outcome,
        observationEvidenceReference: input.evidenceReference,
        observedAt: input.observedAt,
      },
    });
    const claim = await this.findByReference(input.claimReference, input.tenantId);
    if (result.count === 1) return claim;
    return claim?.status === 'active' &&
      claim.ownerToken === input.expectedOwnerToken &&
      claim.observationOutcome === input.outcome &&
      claim.observationEvidenceReference === input.evidenceReference
      ? claim
      : null;
  }

  async release(input: ReleaseSubscriptionMutationClaim): Promise<boolean> {
    const result = await this.delegate.deleteMany({
      where: {
        tenantKey: input.tenantId ?? '',
        subscriptionId: input.subscriptionId,
        ownerToken: input.ownerToken,
        status: 'active',
      },
    });
    return result.count === 1;
  }

  async findByReference(
    claimReference: string,
    tenantId: string | null,
  ): Promise<SubscriptionMutationClaim | null> {
    const row = await this.delegate.findFirst({
      where: { claimReference, tenantKey: tenantId ?? '' },
    });
    return row ? subscriptionMutationClaimToEntity(row) : null;
  }

  async resolve(
    input: ResolveSubscriptionMutationClaim,
  ): Promise<SubscriptionMutationClaim | null> {
    const result = await this.delegate.updateMany({
      where: {
        claimReference: input.claimReference,
        tenantKey: input.tenantId ?? '',
        ownerToken: input.expectedOwnerToken,
        status: 'active',
      },
      data: {
        activeSubscriptionId: null,
        status: 'resolved',
        resolutionOutcome: input.outcome,
        resolutionEvidenceReference: input.evidenceReference,
        resolvedAt: input.resolvedAt,
      },
    });
    return result.count === 0 ? null : this.findByReference(input.claimReference, input.tenantId);
  }
}
