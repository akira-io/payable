import type { Router } from 'express';
import type { Payable } from '../../../payable';
import { checkoutBodySchema, parseBody } from '../../shared/schemas';
import { asyncHandler, jsonBody } from '../helpers';

export function registerCheckoutRoutes(router: Router, payable: Payable): void {
  router.post(
    '/checkout',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(checkoutBodySchema, req.body);
      const builder = payable
        .customer(body.billable)
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
      });
      res.status(201).json(session);
    }),
  );
}
