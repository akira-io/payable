import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Payable } from '../../../payable';
import {
  manageSubscriptionBodySchema,
  parseBody,
  swapSubscriptionBodySchema,
} from '../../shared/schemas';
import { DEFAULT_BODY_LIMIT } from '../limits';

type ManageAction = 'cancel' | 'cancelNow' | 'resume';

export async function registerSubscriptionRoutes(
  scope: FastifyInstance,
  payable: Payable,
): Promise<void> {
  const manage = (action: ManageAction) => async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(manageSubscriptionBodySchema, request.body);
    const params = request.params as { name: string };
    const manager = payable.customer(body.billable).subscription(params.name);
    reply.status(200).send(await manager[action]());
  };

  const routeOptions = { bodyLimit: DEFAULT_BODY_LIMIT };
  scope.post('/subscriptions/:name/cancel', routeOptions, manage('cancel'));
  scope.post('/subscriptions/:name/cancel-now', routeOptions, manage('cancelNow'));
  scope.post('/subscriptions/:name/resume', routeOptions, manage('resume'));
  scope.post('/subscriptions/:name/swap', routeOptions, async (request, reply) => {
    const body = parseBody(swapSubscriptionBodySchema, request.body);
    const params = request.params as { name: string };
    const manager = payable.customer(body.billable).subscription(params.name);
    reply.status(200).send(await manager.swap(body.price));
  });
}
