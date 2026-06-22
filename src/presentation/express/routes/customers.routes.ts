import type { Router } from 'express';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Payable } from '../../../payable';
import { asyncHandler } from '../helpers';

export function registerCustomerRoutes(router: Router, _payable: Payable): void {
  router.post(
    '/customers',
    asyncHandler(async () => {
      throw PayableError.notImplemented('POST /customers');
    }),
  );
}
