import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import { parseBody, parseMoneyInput, refundBodySchema } from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT } from '../limits';

export async function registerRefundRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  scope.post('/refunds', { bodyLimit: DEFAULT_BODY_LIMIT }, async (request, reply) => {
    const body = parseBody(refundBodySchema, request.body);
    const amount = body.amount ? parseMoneyInput(body.amount) : undefined;
    const tenantId = options.resolveTenant?.(request) ?? null;
    const refund = await payable.refund(
      {
        paymentId: body.paymentId,
        amount,
        reason: body.reason,
        authorization: options.resolveAuthorization?.(request),
      },
      tenantId,
    );
    reply.status(201).send(refund);
  });
}
