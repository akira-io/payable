import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { PayableError } from '../../domain/errors/payable-error';

export interface ExpressPayableOptions {
  webhookSignatureHeader?: string;
}

export type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
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

export function payableErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof PayableError) {
    res
      .status(STATUS_BY_CODE[error.code] ?? 500)
      .json({ error: error.code, message: error.message });
    return;
  }
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' });
}

export function flattenHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
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
