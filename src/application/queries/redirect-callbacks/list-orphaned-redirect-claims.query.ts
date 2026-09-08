import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  RedirectCorrelation,
  RedirectCorrelationRepository,
} from '../../../domain/contracts/redirect-correlation-repository.contract';
import { PayableError } from '../../../domain/errors/payable-error';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const DEFAULT_OLDER_THAN_MINUTES = 15;

export interface OrphanedRedirectClaimsInput {
  provider: string;
  tenantId?: string | null;
  olderThanMinutes?: number;
  limit?: number;
}

export class ListOrphanedRedirectClaimsQuery {
  constructor(
    private readonly correlations: RedirectCorrelationRepository | undefined,
    private readonly clock: Clock,
  ) {}

  run(input: OrphanedRedirectClaimsInput): Promise<RedirectCorrelation[]> {
    const correlations = this.correlations;
    if (!correlations) {
      throw new PayableError('Redirect claim reconciliation requires a storage driver', {
        code: 'REDIRECT_CORRELATION_STORAGE_REQUIRED',
      });
    }
    return correlations.findOrphanedClaims({
      provider: input.provider,
      tenantId: input.tenantId ?? null,
      claimedBefore: new Date(this.clock.now().getTime() - this.minutes(input) * 60_000),
      limit: this.limit(input),
    });
  }

  private minutes(input: OrphanedRedirectClaimsInput): number {
    const minutes = input.olderThanMinutes ?? DEFAULT_OLDER_THAN_MINUTES;
    if (minutes < 0) {
      throw new PayableError('olderThanMinutes cannot be negative', {
        code: 'REDIRECT_CORRELATION_QUERY_INVALID',
        context: { olderThanMinutes: minutes },
      });
    }
    return minutes;
  }

  private limit(input: OrphanedRedirectClaimsInput): number {
    const limit = input.limit ?? DEFAULT_LIMIT;
    if (limit < 1) {
      throw new PayableError('limit must be at least 1', {
        code: 'REDIRECT_CORRELATION_QUERY_INVALID',
        context: { limit },
      });
    }
    return Math.min(limit, MAX_LIMIT);
  }
}
