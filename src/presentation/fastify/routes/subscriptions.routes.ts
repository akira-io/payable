import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Payable } from '../../../payable';
import {
  manageSubscriptionBodySchema,
  parseBody,
  swapSubscriptionBodySchema,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

type ManageAction = 'cancel' | 'cancelNow' | 'resume';

export async function registerSubscriptionRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  const manage = (action: ManageAction) => async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(manageSubscriptionBodySchema, request.body);
    const params = request.params as { name: string };
    const tenantId = options.resolveTenant?.(request) ?? null;
    const authorization = options.resolveAuthorization?.(request);
    const manager = payable.customer(body.billable, undefined, tenantId).subscription(params.name);
    reply.status(200).send(await manager[action](authorization));
  };

  const routeOptions = {
    bodyLimit: DEFAULT_BODY_LIMIT,
    config: { rateLimit: options.rateLimit ?? DEFAULT_ROUTE_RATE_LIMIT },
  };
  scope.post('/subscriptions/:name/cancel', routeOptions, manage('cancel'));
  scope.post('/subscriptions/:name/cancel-now', routeOptions, manage('cancelNow'));
  scope.post('/subscriptions/:name/resume', routeOptions, manage('resume'));
  scope.post('/subscriptions/:name/swap', routeOptions, async (request, reply) => {
    const body = parseBody(swapSubscriptionBodySchema, request.body);
    const params = request.params as { name: string };
    const tenantId = options.resolveTenant?.(request) ?? null;
    const manager = payable.customer(body.billable, undefined, tenantId).subscription(params.name);
    reply.status(200).send(await manager.swap(body.price, options.resolveAuthorization?.(request)));
  });
}
