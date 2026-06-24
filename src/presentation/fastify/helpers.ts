import type { FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

export { flattenHeaders } from '../shared/payable-http';

export interface FastifyPayableOptions {
  webhookSignatureHeader?: string;
  authenticate?: onRequestHookHandler;
  resolveTenant?: (request: FastifyRequest) => string | null | undefined;
}

export function payableErrorReply(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.status(frameworkStatus(error) ?? payableErrorStatus(error)).send(payableErrorBody(error));
}

function frameworkStatus(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 ? status : undefined;
}
