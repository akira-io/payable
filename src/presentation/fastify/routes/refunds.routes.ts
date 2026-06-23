import type { FastifyInstance } from 'fastify';
import { Money } from '../../../domain/value-objects/money';
import type { Payable } from '../../../payable';
import { parseBody, refundBodySchema } from '../../shared/schemas';

export async function registerRefundRoutes(
  scope: FastifyInstance,
  payable: Payable,
): Promise<void> {
  scope.post('/refunds', async (request, reply) => {
    const body = parseBody(refundBodySchema, request.body);
    const amount = body.amount ? Money.of(body.amount.amount, body.amount.currency) : undefined;
    const refund = await payable.refund({ paymentId: body.paymentId, amount, reason: body.reason });
    reply.status(201).send(refund);
  });
}
