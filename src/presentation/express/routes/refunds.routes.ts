import { json, type Router } from 'express';
import { Money } from '../../../domain/value-objects/money';
import type { Payable } from '../../../payable';
import { parseBody, refundBodySchema } from '../../shared/schemas';
import { asyncHandler } from '../helpers';

export function registerRefundRoutes(router: Router, payable: Payable): void {
  router.post(
    '/refunds',
    json(),
    asyncHandler(async (req, res) => {
      const body = parseBody(refundBodySchema, req.body);
      const amount = body.amount ? Money.of(body.amount.amount, body.amount.currency) : undefined;
      const refund = await payable.refund({
        paymentId: body.paymentId,
        amount,
        reason: body.reason,
      });
      res.status(201).json(refund);
    }),
  );
}
