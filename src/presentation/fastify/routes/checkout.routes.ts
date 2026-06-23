import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import { checkoutBodySchema, parseBody } from '../../shared/schemas';

export async function registerCheckoutRoutes(
  scope: FastifyInstance,
  payable: Payable,
): Promise<void> {
  scope.post('/checkout', async (request, reply) => {
    const body = parseBody(checkoutBodySchema, request.body);
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
    reply.status(201).send(session);
  });
}
