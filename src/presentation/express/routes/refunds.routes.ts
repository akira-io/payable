import type { Router } from 'express';
import type { Payable } from '../../../payable';
import { parseBody, parseMoneyInput, refundBodySchema } from '../../shared/schemas';
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

export function registerRefundRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.post(
    '/refunds',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(refundBodySchema, req.body);
      const amount = body.amount ? parseMoneyInput(body.amount) : undefined;
      const tenantId = options.resolveTenant?.(req) ?? null;
      const refund = await payable.refund(
        {
          paymentId: body.paymentId,
          amount,
          reason: body.reason,
        },
        tenantId,
      );
      res.status(201).json(refund);
    }),
  );
}
