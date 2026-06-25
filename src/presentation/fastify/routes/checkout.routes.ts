import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import { checkoutBodySchema, parseBody } from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT } from '../limits';

export async function registerCheckoutRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  scope.post('/checkout', { bodyLimit: DEFAULT_BODY_LIMIT }, async (request, reply) => {
    const body = parseBody(checkoutBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
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
      authorization: options.resolveAuthorization?.(request),
    });
    reply.status(201).send(session);
  });
}
