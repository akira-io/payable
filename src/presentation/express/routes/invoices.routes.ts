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
          { billableType: query.billableType, billableId: query.billableId },
          undefined,
          tenantId,
        )
        .invoices(query.limit);
      res.status(200).json(invoices);
    }),
  );

  router.get(
    '/invoices/:id/pdf',
    asyncHandler(async (req, res) => {
      const tenantId = options.resolveTenant?.(req) ?? null;
      const pdf = await payable.invoices(undefined, tenantId).downloadPdf(String(req.params.id));
      res.status(200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
      res.send(Buffer.from(pdf.content));
    }),
  );
}
