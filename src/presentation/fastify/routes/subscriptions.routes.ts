import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Payable } from '../../../payable';
import {
  type ManageSubscriptionAction as ManageAction,
  runManageSubscription,
  runSwapSubscription,
} from '../../shared/operations';
import {
  manageSubscriptionBodySchema,
  parseBody,
  swapSubscriptionBodySchema,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

export async function registerSubscriptionRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  const manage = (action: ManageAction) => async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(manageSubscriptionBodySchema, request.body);
    const params = request.params as { name: string };
    const tenantId = options.resolveTenant?.(request) ?? null;
    const result = await runManageSubscription(
      payable,
      action,
      params.name,
      body.billable,
      tenantId,
      options.resolveAuthorization?.(request),
    );
    reply.status(200).send(result);
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
    const result = await runSwapSubscription(
      payable,
      params.name,
      body,
      tenantId,
      options.resolveAuthorization?.(request),
    );
    reply.status(200).send(result);
  });
}
