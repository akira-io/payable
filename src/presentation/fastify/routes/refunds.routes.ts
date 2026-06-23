import type { FastifyInstance } from 'fastify';
import { PayableError } from '../../../domain/errors/payable-error';
import { Money } from '../../../domain/value-objects/money';
import type { Payable } from '../../../payable';

interface RefundRequestBody {
  paymentId?: string;
  amount?: { amount: number; currency: string };
  reason?: string;
}

export async function registerRefundRoutes(
  scope: FastifyInstance,
  payable: Payable,
): Promise<void> {
  scope.post('/refunds', async (request, reply) => {
    const body = (request.body ?? {}) as RefundRequestBody;
    if (typeof body.paymentId !== 'string' || body.paymentId.length === 0) {
      throw new PayableError('paymentId is required', { code: 'VALIDATION_FAILED' });
    }
    const amount = body.amount ? Money.of(body.amount.amount, body.amount.currency) : undefined;
    const refund = await payable.refund({ paymentId: body.paymentId, amount, reason: body.reason });
    reply.status(201).send(refund);
  });
}
