import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  RedirectCorrelation,
  RedirectCorrelationRepository,
} from '../../../domain/contracts/redirect-correlation-repository.contract';
import { PayableError } from '../../../domain/errors/payable-error';

const DEFAULT_LIMIT = 100;
const DEFAULT_OLDER_THAN_MINUTES = 15;

export interface OrphanedRedirectClaimsInput {
  provider: string;
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
    const minutes = input.olderThanMinutes ?? DEFAULT_OLDER_THAN_MINUTES;
    return correlations.findOrphanedClaims({
      provider: input.provider,
      claimedBefore: new Date(this.clock.now().getTime() - minutes * 60_000),
      limit: input.limit ?? DEFAULT_LIMIT,
    });
  }
}
