import type { Router } from 'express';
import type { Payable } from '../../../payable';
import { listInvoicesQuerySchema, parseBody } from '../../shared/schemas';
import { asyncHandler, type ExpressPayableOptions } from '../helpers';

export function registerInvoiceRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.get(
    '/invoices',
    asyncHandler(async (req, res) => {
      const query = parseBody(listInvoicesQuerySchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const invoices = await payable
        .customer(
          { billableType: query.billableType, billableId: query.billableId, email: '' },
          undefined,
          tenantId,
        )
        .invoices(query.limit);
      res.status(200).json(invoices);
    }),
  );
}
