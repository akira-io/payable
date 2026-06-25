import type { Router } from 'express';
import type { Payable } from '../../../payable';
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
      const builder = payable
        .customer(body.billable, undefined, tenantId)
        .newSubscription(body.subscription.name)
        .price(body.subscription.price);
      if (body.subscription.trialDays !== undefined) {
        builder.trialDays(body.subscription.trialDays);
      }
      if (body.subscription.coupon) {
        builder.coupon(body.subscription.coupon);
      }
      const session = await builder.checkout({
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        authorization: options.resolveAuthorization?.(req),
      });
      res.status(201).json(session);
    }),
  );
}
