import type { Logger } from '../../../domain/contracts/logger.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';
import type { TmtTransactionResponse } from './trust-my-travel-transactions';

const TERMINAL_STATUSES: Record<string, PaymentStatus> = {
  expired: 'failed',
  failed: 'failed',
  pending: 'processing',
};

export function trustMyTravelPaymentStatus(
  transaction: TmtTransactionResponse,
  logger?: Logger,
): PaymentStatus {
  if (transaction.status === 'locked') {
    throw new PayableError('Trust My Travel transaction is locked', {
      code: 'PROVIDER_TRANSACTION_LOCKED',
      context: { provider: 'trust-my-travel', providerPaymentId: transaction.id },
    });
  }
  if (transaction.status === 'incomplete') {
    throw new PayableError('Trust My Travel transaction result is unknown', {
      code: 'PROVIDER_RESULT_UNKNOWN',
      context: { provider: 'trust-my-travel', providerPaymentId: transaction.id },
    });
  }
  if (transaction.status === 'expired') {
    logger?.warn('Trust My Travel transaction expired', {
      provider: 'trust-my-travel',
      providerPaymentId: transaction.id,
      providerStatus: transaction.status,
    });
  }
  if (transaction.status === 'complete') {
    if (transaction.transaction_types === 'authorize') return 'authorized';
    if (transaction.transaction_types === 'void') return 'canceled';
    return 'succeeded';
  }
  return TERMINAL_STATUSES[transaction.status] ?? 'pending';
}
