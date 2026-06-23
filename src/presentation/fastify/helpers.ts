import type { FastifyReply, FastifyRequest } from 'fastify';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';

export { flattenHeaders } from '../shared/payable-http';

export interface FastifyPayableOptions {
  webhookSignatureHeader?: string;
}

export function payableErrorReply(
  error: unknown,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.status(payableErrorStatus(error)).send(payableErrorBody(error));
}
