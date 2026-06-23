import type { IncomingHttpHeaders } from 'node:http';
import { PayableError } from '../../domain/errors/payable-error';

const STATUS_BY_CODE: Record<string, number> = {
  NOT_IMPLEMENTED: 501,
  INVALID_WEBHOOK_SIGNATURE: 400,
  INVALID_WEBHOOK_PAYLOAD: 400,
  WEBHOOK_PROVIDER_AMBIGUOUS: 400,
  VALIDATION_FAILED: 422,
  PROVIDER_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  SUBSCRIPTION_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PROVIDER_CAPABILITY_NOT_SUPPORTED: 422,
  CHECKOUT_PRICE_REQUIRED: 422,
  CHECKOUT_LINE_ITEMS_REQUIRED: 422,
  SUBSCRIPTION_PRICE_REQUIRED: 422,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_NOT_REFUNDABLE: 422,
  REFUND_EXCEEDS_REMAINING: 422,
  WEBHOOK_EVENT_NOT_FOUND: 404,
  WEBHOOK_REPLAY_DENIED: 403,
  WEBHOOK_STORAGE_REQUIRED: 500,
  TENANT_REQUIRED: 400,
  AUTHORIZATION_DENIED: 403,
};

export interface PayableErrorBody {
  error: string;
  message: string;
}

export function payableErrorStatus(error: unknown): number {
  return error instanceof PayableError ? (STATUS_BY_CODE[error.code] ?? 500) : 500;
}

export function payableErrorBody(error: unknown): PayableErrorBody {
  return error instanceof PayableError
    ? { error: error.code, message: error.message }
    : { error: 'INTERNAL_ERROR', message: 'Unexpected error' };
}

export function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value.join(',');
      continue;
    }
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
