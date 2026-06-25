import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import { runCheckout } from '../../shared/operations';
import { checkoutBodySchema, parseBody } from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

export async function registerCheckoutRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  scope.post(
    '/checkout',
    {
      bodyLimit: DEFAULT_BODY_LIMIT,
      config: { rateLimit: options.rateLimit ?? DEFAULT_ROUTE_RATE_LIMIT },
    },
    async (request, reply) => {
      const body = parseBody(checkoutBodySchema, request.body);
      const tenantId = options.resolveTenant?.(request) ?? null;
      const session = await runCheckout(
        payable,
        body,
        tenantId,
        options.resolveAuthorization?.(request),
      );
      reply.status(201).send(session);
    },
  );
}
