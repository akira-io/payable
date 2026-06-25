import type { Router } from 'express';
import type { Payable } from '../../../payable';
import { runCheckout } from '../../shared/operations';
import { checkoutBodySchema, parseBody } from '../../shared/schemas';
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

export function registerCheckoutRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.post(
    '/checkout',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(checkoutBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const session = await runCheckout(
        payable,
        body,
        tenantId,
        options.resolveAuthorization?.(req),
      );
      res.status(201).json(session);
    }),
  );
}
