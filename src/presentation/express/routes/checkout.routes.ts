import { json, type Router } from 'express';
import type { Billable } from '../../../application/builders/billable';
import type { Payable } from '../../../payable';
import { asyncHandler } from '../helpers';

interface CheckoutRequestBody {
  billable: Billable;
  subscription: { name: string; price: string; trialDays?: number; coupon?: string };
  successUrl: string;
  cancelUrl: string;
}

export function registerCheckoutRoutes(router: Router, payable: Payable): void {
  router.post(
    '/checkout',
    json(),
    asyncHandler(async (req, res) => {
      const body = req.body as CheckoutRequestBody;
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
