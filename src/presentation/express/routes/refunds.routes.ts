import type { Router } from 'express';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Payable } from '../../../payable';
import { asyncHandler } from '../helpers';

export function registerRefundRoutes(router: Router, _payable: Payable): void {
  router.post(
    '/refunds',
    asyncHandler(async () => {
      throw PayableError.notImplemented('POST /refunds');
    }),
  );
}
