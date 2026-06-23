import { json, type Router } from 'express';
import { PayableError } from '../../../domain/errors/payable-error';
import { Money } from '../../../domain/value-objects/money';
import type { Payable } from '../../../payable';
import { asyncHandler } from '../helpers';

interface RefundRequestBody {
  paymentId?: string;
  amount?: { amount: number; currency: string };
  reason?: string;
}

export function registerRefundRoutes(router: Router, payable: Payable): void {
  router.post(
    '/refunds',
    json(),
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as RefundRequestBody;
      if (typeof body.paymentId !== 'string' || body.paymentId.length === 0) {
        throw new PayableError('paymentId is required', { code: 'VALIDATION_FAILED' });
      }
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
