import type { FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

export { flattenHeaders } from '../shared/payable-http';

export interface FastifyPayableOptions {
  webhookSignatureHeader?: string;
  authenticate?: onRequestHookHandler;
}

export function payableErrorReply(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.status(payableErrorStatus(error)).send(payableErrorBody(error));
}
