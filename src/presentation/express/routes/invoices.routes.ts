import type { Router } from 'express';
import { PayableError } from '../../../domain/errors/payable-error';
import type { Payable } from '../../../payable';
import { asyncHandler } from '../helpers';

export function registerInvoiceRoutes(router: Router, _payable: Payable): void {
  router.get(
    '/invoices',
    asyncHandler(async () => {
      throw PayableError.notImplemented('GET /invoices');
    }),
  );
}
