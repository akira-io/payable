import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  RecurringPaymentReconciliationCursor,
  RecurringPaymentReconciliationInput,
  RecurringPaymentReconciliationResult,
} from '../../../domain/contracts/recurring-payment-reconciliation.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { isPaymentStatus, type PaymentStatus } from '../../../domain/value-objects/payment-status';
import type { TmtTransactionResponse } from './trust-my-travel-transactions';

const DEFAULT_MAX_ATTEMPTS = 35;
const DEFAULT_BASE_DELAY_MS = 60_000;
const DEFAULT_MAX_DELAY_MS = 86_400_000;
const MAX_ATTEMPTS = 100;

export interface TrustMyTravelReconciliationOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

interface ResolvedOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export class TrustMyTravelReconciliation {
  private readonly options: ResolvedOptions;

  constructor(
    private readonly find: (id: string) => Promise<TmtTransactionResponse>,
    private readonly clock: Clock,
    options: TrustMyTravelReconciliationOptions = {},
  ) {
    this.options = resolveOptions(options);
  }

  async reconcile(
    input: RecurringPaymentReconciliationInput,
  ): Promise<RecurringPaymentReconciliationResult> {
    this.assertInput(input);
    const attempt = (input.cursor?.attempt ?? 0) + 1;
    const transaction = await this.find(input.providerPaymentId);
    if (typeof transaction.status !== 'string' || transaction.status.length === 0) {
      throw new PayableError('Trust My Travel transaction response is invalid', {
        code: 'PROVIDER_TMT_TRANSACTION_RESPONSE_INVALID',
        context: { provider: 'trust-my-travel' },
      });
    }
    if (String(transaction.id) !== input.providerPaymentId) {
      throw new PayableError('Trust My Travel returned a different transaction', {
        code: 'PROVIDER_TMT_TRANSACTION_ID_MISMATCH',
        context: { provider: 'trust-my-travel' },
      });
    }
    const status = recurringStatus(transaction.status);
    const observation = {
      providerPaymentId: String(transaction.id),
      providerStatus: transaction.status,
      status,
      attempt,
      ...chargebackData(transaction),
    };

    if (
      transaction.status === 'complete' ||
      transaction.status === 'failed' ||
      transaction.status === 'expired'
    ) {
      return { outcome: 'terminal', ...observation };
    }
    if (attempt >= this.options.maxAttempts) {
      return { outcome: 'exhausted', ...observation, reason: 'attempt_limit' };
    }
    const delay = Math.min(this.options.baseDelayMs * 2 ** (attempt - 1), this.options.maxDelayMs);
    const cursor: RecurringPaymentReconciliationCursor = {
      providerPaymentId: observation.providerPaymentId,
      attempt,
      nextAttemptAt: new Date(this.clock.now().getTime() + delay).toISOString(),
      lastProviderStatus: observation.providerStatus,
      lastStatus: status,
    };
    return { outcome: 'retry', ...observation, cursor };
  }

  private assertInput(input: RecurringPaymentReconciliationInput): void {
    if (
      typeof input.providerPaymentId !== 'string' ||
      input.providerPaymentId.trim().length === 0
    ) {
      throw new PayableError('Recurring reconciliation input is invalid', {
        code: 'PROVIDER_RECONCILIATION_INPUT_INVALID',
      });
    }
    const cursor = input.cursor;
    if (!cursor) return;
    const validDate = Number.isFinite(Date.parse(cursor.nextAttemptAt));
    const validAttempt =
      Number.isInteger(cursor.attempt) &&
      cursor.attempt > 0 &&
      cursor.attempt < this.options.maxAttempts;
    const validObservation =
      typeof cursor.lastProviderStatus === 'string' && isPaymentStatus(cursor.lastStatus);
    if (
      cursor.providerPaymentId !== input.providerPaymentId ||
      !validDate ||
      !validAttempt ||
      !validObservation
    ) {
      throw cursorError('Recurring reconciliation cursor is invalid');
    }
    if (Date.parse(cursor.nextAttemptAt) > this.clock.now().getTime()) {
      throw cursorError(
        'Recurring reconciliation is not due yet',
        'PROVIDER_RECONCILIATION_NOT_DUE',
      );
    }
  }
}

function recurringStatus(providerStatus: string): PaymentStatus {
  if (providerStatus === 'complete') return 'succeeded';
  if (providerStatus === 'failed' || providerStatus === 'expired') return 'failed';
  if (providerStatus === 'pending') return 'processing';
  return 'pending';
}

function resolveOptions(options: TrustMyTravelReconciliationOptions): ResolvedOptions {
  const resolved = {
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
  };
  if (
    !Number.isInteger(resolved.maxAttempts) ||
    resolved.maxAttempts < 1 ||
    resolved.maxAttempts > MAX_ATTEMPTS ||
    !Number.isInteger(resolved.baseDelayMs) ||
    resolved.baseDelayMs < 1 ||
    !Number.isInteger(resolved.maxDelayMs) ||
    resolved.maxDelayMs < resolved.baseDelayMs
  ) {
    throw new PayableError('Trust My Travel reconciliation options are invalid', {
      code: 'PROVIDER_TMT_RECONCILIATION_OPTIONS_INVALID',
      context: { provider: 'trust-my-travel' },
    });
  }
  return resolved;
}

function chargebackData(
  transaction: TmtTransactionResponse,
): { providerData: Readonly<Record<string, unknown>> } | Record<string, never> {
  const providerData = {
    ...(transaction.chargeback_status === undefined
      ? {}
      : { chargebackStatus: transaction.chargeback_status }),
    ...(transaction.outcome_status === undefined
      ? {}
      : { outcomeStatus: transaction.outcome_status }),
    ...(transaction.reason_code === undefined ? {} : { reasonCode: transaction.reason_code }),
    ...(transaction.challenge_date === undefined
      ? {}
      : { challengeDate: transaction.challenge_date }),
  };
  return Object.keys(providerData).length === 0 ? {} : { providerData };
}

function cursorError(
  message: string,
  code = 'PROVIDER_RECONCILIATION_CURSOR_INVALID',
): PayableError {
  return new PayableError(message, {
    code,
    context: { provider: 'trust-my-travel' },
  });
}
