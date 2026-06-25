import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import { runRefund } from '../../shared/operations';
import { parseBody, refundBodySchema } from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

export async function registerRefundRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  scope.post(
    '/refunds',
    {
      bodyLimit: DEFAULT_BODY_LIMIT,
      config: { rateLimit: options.rateLimit ?? DEFAULT_ROUTE_RATE_LIMIT },
    },
    async (request, reply) => {
      const body = parseBody(refundBodySchema, request.body);
      const tenantId = options.resolveTenant?.(request) ?? null;
      const refund = await runRefund(
        payable,
        body,
        tenantId,
        options.resolveAuthorization?.(request),
      );
      reply.status(201).send(refund);
    },
  );
}
