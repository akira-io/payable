import { json, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

export { flattenHeaders } from '../shared/payable-http';

const DEFAULT_BODY_LIMIT = '64kb';

export function jsonBody(): RequestHandler {
  return json({ limit: DEFAULT_BODY_LIMIT });
}

export interface ExpressPayableOptions {
  webhookSignatureHeader?: string;
  authenticate?: RequestHandler;
  resolveTenant?: (req: Request) => string | null | undefined;
}

export type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function httpStatusFor(error: unknown): number {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status;
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  if (typeof status === 'number') {
    return status;
  }
  if (typeof statusCode === 'number') {
    return statusCode;
  }
  return payableErrorStatus(error);
}

export function payableErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  res.status(httpStatusFor(error)).json(payableErrorBody(error));
}
