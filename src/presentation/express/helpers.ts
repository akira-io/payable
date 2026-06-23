import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

export { flattenHeaders } from '../shared/payable-http';

export interface ExpressPayableOptions {
  webhookSignatureHeader?: string;
  authenticate?: RequestHandler;
}

export type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>;

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function payableErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  res.status(payableErrorStatus(error)).json(payableErrorBody(error));
}
