import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';
import type { AuthorizationContext } from '../../application/policies/authorization-context';
import { PayableError } from '../../domain/errors/payable-error';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

export { flattenHeaders } from '../shared/payable-http';

export interface FastifyPayableOptions {
  webhookSignatureHeader?: string;
  authenticate?: onRequestHookHandler;
  resolveTenant?: (request: FastifyRequest) => string | null | undefined;
  resolveAuthorization?: (request: FastifyRequest) => AuthorizationContext | undefined;
  rateLimit?: RateLimitPluginOptions;
}

export function payableErrorReply(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  const status =
    error instanceof PayableError
      ? payableErrorStatus(error)
      : (frameworkStatus(error) ?? payableErrorStatus(error));
  reply.status(status).send(payableErrorBody(error));
}

function frameworkStatus(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 ? status : undefined;
}
