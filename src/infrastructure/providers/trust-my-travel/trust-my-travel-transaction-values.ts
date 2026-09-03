import { PayableError } from '../../../domain/errors/payable-error';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import type { TmtTransactionBooking } from './trust-my-travel-transactions';

export interface TmtCallbackPayload {
  id: string | number;
  status: string;
  total: string | number;
  hash: string;
}

export function callbackPayload(payload: Record<string, unknown>): TmtCallbackPayload | null {
  const { id, status, total, hash } = payload;
  const validId = typeof id === 'string' || typeof id === 'number';
  const validTotal = typeof total === 'string' || typeof total === 'number';
  if (!validId || typeof status !== 'string' || !validTotal || typeof hash !== 'string')
    return null;
  return { id, status, total, hash } as TmtCallbackPayload;
}

export function asyncCallbackPayload(
  payload: Record<string, unknown>,
): { id: string | number } | null {
  const { id, status, total, hash } = payload;
  const validId = typeof id === 'string' || typeof id === 'number';
  if (!validId || status !== undefined || total !== undefined || hash !== undefined) return null;
  return { id } as { id: string | number };
}

export function isTransactionBooking(value: unknown): value is TmtTransactionBooking {
  if (!value || typeof value !== 'object') return false;
  const booking = value as Record<string, unknown>;
  return (
    Number.isInteger(booking.id) &&
    typeof booking.currencies === 'string' &&
    Number.isInteger(booking.total)
  );
}

export function refundStatus(status: string): RefundStatus {
  const statuses: Record<string, RefundStatus> = {
    complete: 'succeeded',
    expired: 'canceled',
    failed: 'failed',
  };
  return statuses[status] ?? 'pending';
}

export function positiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PayableError(`Trust My Travel ${field} must be a positive integer`, {
      code: 'PROVIDER_TMT_PAYMENT_LIFECYCLE_INVALID',
      context: { provider: 'trust-my-travel', field },
    });
  }
  return parsed;
}
