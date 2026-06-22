import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Billable } from '../../../application/builders/billable';
import type { Payable } from '../../../payable';

type ManageAction = 'cancel' | 'cancelNow' | 'resume';

export async function registerSubscriptionRoutes(
  scope: FastifyInstance,
  payable: Payable,
): Promise<void> {
  const manage = (action: ManageAction) => async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { billable: Billable };
    const params = request.params as { name: string };
    const manager = payable.customer(body.billable).subscription(params.name);
    reply.status(200).send(await manager[action]());
  };

  scope.post('/subscriptions/:name/cancel', manage('cancel'));
  scope.post('/subscriptions/:name/cancel-now', manage('cancelNow'));
  scope.post('/subscriptions/:name/resume', manage('resume'));
  scope.post('/subscriptions/:name/swap', async (request, reply) => {
    const body = request.body as { billable: Billable; price: string };
    const params = request.params as { name: string };
    const manager = payable.customer(body.billable).subscription(params.name);
    reply.status(200).send(await manager.swap(body.price));
  });
}
