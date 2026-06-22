import type { Router } from 'express';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Payable } from '../../../payable';
import { asyncHandler } from '../helpers';

export function registerPaymentRoutes(router: Router, _payable: Payable): void {
  router.get(
    '/payments',
    asyncHandler(async () => {
      throw PayableError.notImplemented('GET /payments');
    }),
  );
}
