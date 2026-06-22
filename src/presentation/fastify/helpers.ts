import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PayableError } from '../../domain/errors/payable-error';

export interface FastifyPayableOptions {
  webhookSignatureHeader?: string;
}

const STATUS_BY_CODE: Record<string, number> = {
  NOT_IMPLEMENTED: 501,
  INVALID_WEBHOOK_SIGNATURE: 400,
  PROVIDER_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  SUBSCRIPTION_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PROVIDER_CAPABILITY_NOT_SUPPORTED: 422,
  CHECKOUT_PRICE_REQUIRED: 422,
  CHECKOUT_LINE_ITEMS_REQUIRED: 422,
  WEBHOOK_STORAGE_REQUIRED: 500,
};

export function payableErrorReply(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof PayableError) {
    reply
      .status(STATUS_BY_CODE[error.code] ?? 500)
      .send({ error: error.code, message: error.message });
    return;
  }
  reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' });
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
