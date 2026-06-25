import type { Router } from 'express';
import type { Payable } from '../../../payable';
import { billableLookupSchema, parseBody } from '../../shared/schemas';
import { asyncHandler, type ExpressPayableOptions } from '../helpers';

export function registerPaymentRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.get(
    '/payments',
    asyncHandler(async (req, res) => {
      const query = parseBody(billableLookupSchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const payments = await payable.customer({ ...query }, undefined, tenantId).payments();
      res.status(200).json(payments);
    }),
  );
}
