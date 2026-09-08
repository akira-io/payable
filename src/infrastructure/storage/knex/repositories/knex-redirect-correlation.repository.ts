import type { Knex } from 'knex';
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
import { fromDate, toBool, toDate, toNullableDate } from '../mappers';
import { isUniqueViolation } from '../unique-violation';

export class KnexRedirectCorrelationRepository implements RedirectCorrelationRepository {
  private readonly table = 'payable_redirect_correlations';

  constructor(private readonly knex: Knex) {}

  async record(input: NewRedirectCorrelation): Promise<void> {
    try {
      await this.knex(this.table).insert({
        provider: input.provider,
        merchant_ref: input.merchantRef,
        merchant_session: input.merchantSession,
        tenant_id: input.tenantId,
        amount: input.amount,
        currency: input.currency,
        transaction_code: input.transactionCode,
        recorded_at: fromDate(input.recordedAt),
        claimed_at: null,
        processed_at: null,
        outcome_verified: null,
        outcome_status: null,
        outcome_reason: null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
  }

  async findSessionsByReference(provider: string, merchantRef: string): Promise<string[]> {
    const rows = (await this.knex(this.table)
      .where({ provider, merchant_ref: merchantRef })
      .select('merchant_session')) as Array<{ merchant_session: string }>;
    return rows.map((row) => row.merchant_session);
  }

  async claim(key: RedirectCorrelationKey, claimedAt: Date): Promise<RedirectCorrelationClaim> {
    const affected = await this.scope(key)
      .whereNull('claimed_at')
      .update({ claimed_at: fromDate(claimedAt) });
    const row = await this.find(key);
    if (affected === 1 && row) {
      return {
        status: 'claimed',
        expected: {
          amount: row.amount,
          currency: row.currency,
          transactionCode: row.transactionCode,
        },
      };
    }
    if (affected === 1) {
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
    await this.scope(key).update({
      processed_at: fromDate(outcome.processedAt),
      outcome_verified: outcome.verified,
      outcome_status: outcome.status,
      outcome_reason: outcome.reason,
    });
  }

  async findOrphanedClaims(
    query: OrphanedRedirectCorrelationQuery,
  ): Promise<RedirectCorrelation[]> {
    const rows = (await this.knex(this.table)
      .where({ provider: query.provider, tenant_id: query.tenantId })
      .whereNotNull('claimed_at')
      .whereNull('processed_at')
      .where('claimed_at', '<', fromDate(query.claimedBefore) as string)
      .orderBy('claimed_at', 'asc')
      .limit(query.limit)) as Array<Record<string, unknown>>;
    return rows.map(toCorrelation);
  }

  private scope(key: RedirectCorrelationKey): Knex.QueryBuilder {
    return this.knex(this.table).where({
      provider: key.provider,
      merchant_ref: key.merchantRef,
      merchant_session: key.merchantSession,
    });
  }

  private async find(key: RedirectCorrelationKey): Promise<RedirectCorrelation | null> {
    const row = (await this.scope(key).first()) as Record<string, unknown> | undefined;
    return row ? toCorrelation(row) : null;
  }
}

function toCorrelation(row: Record<string, unknown>): RedirectCorrelation {
  return {
    provider: row.provider as string,
    merchantRef: row.merchant_ref as string,
    merchantSession: row.merchant_session as string,
    tenantId: (row.tenant_id as string | null) ?? null,
    amount: String(row.amount),
    currency: (row.currency as string | null) ?? null,
    transactionCode: (row.transaction_code as string | null) ?? null,
    recordedAt: toDate(row.recorded_at),
    claimedAt: toNullableDate(row.claimed_at),
    processedAt: toNullableDate(row.processed_at),
    outcomeVerified:
      row.outcome_verified === null || row.outcome_verified === undefined
        ? null
        : toBool(row.outcome_verified),
    outcomeStatus: (row.outcome_status as string | null) ?? null,
    outcomeReason: (row.outcome_reason as string | null) ?? null,
  };
}
