import type { Router } from 'express';
import type { Payable } from '../../../payable';
import { parseBody, parseMoneyInput, refundBodySchema } from '../../shared/schemas';
import { asyncHandler, jsonBody } from '../helpers';

export function registerRefundRoutes(router: Router, payable: Payable): void {
  router.post(
    '/refunds',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(refundBodySchema, req.body);
      const amount = body.amount ? parseMoneyInput(body.amount) : undefined;
      const refund = await payable.refund({
        paymentId: body.paymentId,
        amount,
        reason: body.reason,
      });
      res.status(201).json(refund);
    }),
  );
}
