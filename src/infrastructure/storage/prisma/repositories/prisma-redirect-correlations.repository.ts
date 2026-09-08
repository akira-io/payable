import type {
  NewRedirectCorrelation,
  OrphanedRedirectCorrelationQuery,
  RedirectCorrelation,
  RedirectCorrelationClaim,
  RedirectCorrelationKey,
  RedirectCorrelationOutcome,
  RedirectCorrelationRepository,
} from '../../../../domain/contracts/redirect-correlation-repository.contract';
import { PayableError } from '../../../../domain/errors/payable-error';
import type {
  PrismaClient,
  PrismaDelegate,
  PrismaRedirectCorrelationRow,
} from '../prisma-client.types';
import { isPrismaUniqueViolation } from '../unique-violation';

export class PrismaRedirectCorrelationsRepository implements RedirectCorrelationRepository {
  private readonly delegate: PrismaDelegate<PrismaRedirectCorrelationRow>;

  constructor(client: PrismaClient) {
    this.delegate = client.payableRedirectCorrelation;
  }

  async record(input: NewRedirectCorrelation): Promise<void> {
    try {
      await this.delegate.create({
        data: {
          provider: input.provider,
          merchantRef: input.merchantRef,
          merchantSession: input.merchantSession,
          tenantId: input.tenantId,
          amount: input.amount,
          currency: input.currency,
          transactionCode: input.transactionCode,
          recordedAt: input.recordedAt,
          claimedAt: null,
          processedAt: null,
          outcomeVerified: null,
          outcomeStatus: null,
          outcomeReason: null,
        },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) return;
      throw error;
    }
  }

  async findSessionsByReference(provider: string, merchantRef: string): Promise<string[]> {
    const rows = await this.delegate.findMany({ where: { provider, merchantRef } });
    return rows.map((row) => row.merchantSession);
  }

  async claim(key: RedirectCorrelationKey, claimedAt: Date): Promise<RedirectCorrelationClaim> {
    const result = await this.delegate.updateMany({
      where: { ...identity(key), claimedAt: null },
      data: { claimedAt },
    });
    const row = await this.delegate.findFirst({ where: identity(key) });
    if (result.count === 1 && row) {
      return {
        status: 'claimed',
        expected: {
          amount: String(row.amount),
          currency: row.currency ?? null,
          transactionCode: row.transactionCode ?? null,
        },
      };
    }
    if (result.count === 1) {
      throw new PayableError('The redirect correlation vanished while it was being claimed', {
        code: 'REDIRECT_CORRELATION_CLAIM_LOST',
        context: { provider: key.provider, merchantRef: key.merchantRef },
      });
    }
    return row ? { status: 'already_claimed' } : { status: 'missing' };
  }

  async markProcessed(
    key: RedirectCorrelationKey,
    outcome: RedirectCorrelationOutcome,
  ): Promise<void> {
    await this.delegate.updateMany({
      where: identity(key),
      data: {
        processedAt: outcome.processedAt,
        outcomeVerified: outcome.verified,
        outcomeStatus: outcome.status,
        outcomeReason: outcome.reason,
      },
    });
  }

  async findOrphanedClaims(
    query: OrphanedRedirectCorrelationQuery,
  ): Promise<RedirectCorrelation[]> {
    const rows = await this.delegate.findMany({
      where: {
        provider: query.provider,
        tenantId: query.tenantId,
        claimedAt: { not: null, lt: query.claimedBefore },
        processedAt: null,
      },
      orderBy: { claimedAt: 'asc' },
      take: query.limit,
    });
    return rows.map(toCorrelation);
  }
}

function identity(key: RedirectCorrelationKey): Record<string, unknown> {
  return {
    provider: key.provider,
    merchantRef: key.merchantRef,
    merchantSession: key.merchantSession,
  };
}

function toCorrelation(row: PrismaRedirectCorrelationRow): RedirectCorrelation {
  return {
    provider: row.provider,
    merchantRef: row.merchantRef,
    merchantSession: row.merchantSession,
    tenantId: row.tenantId ?? null,
    amount: String(row.amount),
    currency: row.currency ?? null,
    transactionCode: row.transactionCode ?? null,
    recordedAt: row.recordedAt,
    claimedAt: row.claimedAt ?? null,
    processedAt: row.processedAt ?? null,
    outcomeVerified: row.outcomeVerified ?? null,
    outcomeStatus: row.outcomeStatus ?? null,
    outcomeReason: row.outcomeReason ?? null,
  };
}
