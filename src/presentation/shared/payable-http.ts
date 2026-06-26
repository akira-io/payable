import type { IncomingHttpHeaders } from 'node:http';
import { PayableError } from '../../domain/errors/payable-error';

const STATUS_BY_CODE: Record<string, number> = {
  NOT_IMPLEMENTED: 501,
  INVALID_WEBHOOK_SIGNATURE: 400,
  INVALID_WEBHOOK_PAYLOAD: 400,
  WEBHOOK_PROVIDER_AMBIGUOUS: 400,
  VALIDATION_FAILED: 422,
  CUSTOMER_EMAIL_INVALID: 422,
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
  INVOICE_NOT_FOUND: 404,
  INVOICE_STORAGE_REQUIRED: 500,
  PAYMENT_NOT_REFUNDABLE: 422,
  REFUND_EXCEEDS_REMAINING: 422,
  WEBHOOK_EVENT_NOT_FOUND: 404,
  WEBHOOK_REPLAY_DENIED: 403,
  WEBHOOK_STORAGE_REQUIRED: 500,
  WEBHOOK_PROCESSING_FAILED: 503,
  WEBHOOK_ENDPOINT_INVALID_URL: 422,
  WEBHOOK_ENDPOINT_EVENTS_REQUIRED: 422,
  WEBHOOK_ENDPOINT_STORAGE_REQUIRED: 500,
  TENANT_REQUIRED: 400,
  AUTHORIZATION_DENIED: 403,
};

export interface PayableErrorBody {
  error: string;
  message: string;
  fields?: Array<{ field: string; message: string }>;
}

export function payableErrorStatus(error: unknown): number {
  return error instanceof PayableError ? (STATUS_BY_CODE[error.code] ?? 500) : 500;
}

function nonPayableErrorBody(error: unknown): PayableErrorBody {
  const candidate = error as { type?: string; status?: number; statusCode?: number };
  if (candidate.type === 'entity.too.large') {
    return {
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Request body exceeds the configured size limit',
    };
  }
  if (candidate.type === 'entity.parse.failed') {
    return { error: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }
  const status = candidate.status ?? candidate.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { error: 'BAD_REQUEST', message: 'Invalid request' };
  }
  return { error: 'INTERNAL_ERROR', message: 'Unexpected error' };
}

export function payableErrorBody(error: unknown): PayableErrorBody {
  if (error instanceof PayableError) {
    const body: PayableErrorBody = { error: error.code, message: error.message };
    const issues = error.context?.issues;
    if (error.code === 'VALIDATION_FAILED' && Array.isArray(issues)) {
      body.fields = issues as Array<{ field: string; message: string }>;
    }
    return body;
  }
  return nonPayableErrorBody(error);
}

export function safeContentDispositionFilename(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'invoice.pdf';
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
