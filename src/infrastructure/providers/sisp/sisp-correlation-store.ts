import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  RedirectCorrelationKey,
  RedirectCorrelationRepository,
} from '../../../domain/contracts/redirect-correlation-repository.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { SystemClock } from '../../../support/clock/system-clock';
import type {
  SispCallbackOutcome,
  SispCorrelationClaim,
  SispPaymentCorrelationStore,
  SispPaymentRequest,
} from './sisp-types';

const PROVIDER = 'sisp';

export interface SispCorrelationStorage {
  readonly redirectCorrelations?: RedirectCorrelationRepository;
}

export interface SispCorrelationStoreOptions {
  clock?: Clock;
  tenantId?: string | null;
}

export function payableSispCorrelationStore(
  storage: SispCorrelationStorage,
  options: SispCorrelationStoreOptions = {},
): SispPaymentCorrelationStore {
  const repository = storage.redirectCorrelations;
  if (!repository) {
    throw new PayableError('SISP correlation requires a storage driver with redirectCorrelations', {
      code: 'PROVIDER_SISP_CORRELATION_STORAGE_MISSING',
      context: { provider: PROVIDER },
    });
  }
  const clock = options.clock ?? new SystemClock();
  const tenantId = options.tenantId ?? null;

  return {
    async record(request: SispPaymentRequest): Promise<void> {
      const sessions = await repository.findSessionsByReference(PROVIDER, request.merchantRef);
      if (sessions.some((session) => session !== request.merchantSession)) {
        throw new PayableError('This SISP merchant reference already started a payment', {
          code: 'PROVIDER_SISP_DUPLICATE_MERCHANT_REFERENCE',
          context: { provider: PROVIDER, merchantRef: request.merchantRef },
        });
      }
      await repository.record({
        provider: PROVIDER,
        merchantRef: request.merchantRef,
        merchantSession: request.merchantSession,
        tenantId,
        amount: String(request.amount),
        currency: request.currency,
        transactionCode: request.transactionCode,
        recordedAt: clock.now(),
      });
    },

    async claim(merchantRef: string, merchantSession: string): Promise<SispCorrelationClaim> {
      const claim = await repository.claim(key(merchantRef, merchantSession), clock.now());
      if (claim.status === 'claimed') {
        return {
          status: 'claimed',
          payment: {
            amount: claim.expected.amount,
            currency: claim.expected.currency ?? undefined,
            transactionCode: claim.expected.transactionCode ?? undefined,
          },
        };
      }
      return claim.status === 'missing' ? { status: 'missing' } : { status: 'already_processed' };
    },

    async markProcessed(
      merchantRef: string,
      merchantSession: string,
      outcome: SispCallbackOutcome,
    ): Promise<void> {
      await repository.markProcessed(key(merchantRef, merchantSession), {
        verified: outcome.verified,
        status: outcome.status,
        reason: outcome.reason,
        processedAt: clock.now(),
      });
    },
  };
}

function key(merchantRef: string, merchantSession: string): RedirectCorrelationKey {
  return { provider: PROVIDER, merchantRef, merchantSession };
}
