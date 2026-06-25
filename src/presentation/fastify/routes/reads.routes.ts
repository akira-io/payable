import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import {
  billableLookupSchema,
  listInvoicesQuerySchema,
  listRefundsQuerySchema,
  listSubscriptionsQuerySchema,
  parseBody,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';

export async function registerReadRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  scope.get('/invoices', async (request, reply) => {
    const query = parseBody(listInvoicesQuerySchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const invoices = await payable
      .customer(
        { billableType: query.billableType, billableId: query.billableId, email: '' },
        undefined,
        tenantId,
      )
      .invoices(query.limit);
    reply.status(200).send(invoices);
  });

  scope.get('/payments', async (request, reply) => {
    const query = parseBody(billableLookupSchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const payments = await payable
      .customer({ ...query, email: '' }, undefined, tenantId)
      .payments();
    reply.status(200).send(payments);
  });

  scope.get('/subscriptions', async (request, reply) => {
    const query = parseBody(listSubscriptionsQuerySchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const subscriptions = await payable
      .customer(
        { billableType: query.billableType, billableId: query.billableId, email: '' },
        undefined,
        tenantId,
      )
      .subscriptions(query.limit ? { limit: query.limit } : undefined);
    reply.status(200).send(subscriptions);
  });

  scope.get('/subscriptions/:name', async (request, reply) => {
    const query = parseBody(billableLookupSchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const name = String((request.params as { name: string }).name);
    const subscription = await payable
      .customer({ ...query, email: '' }, undefined, tenantId)
      .subscription(name)
      .get();
    if (!subscription) {
      reply
        .status(404)
        .send({ error: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' });
      return;
    }
    reply.status(200).send(subscription);
  });

  scope.get('/refunds', async (request, reply) => {
    const query = parseBody(listRefundsQuerySchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const refunds = await payable
      .refunds(undefined, tenantId)
      .list(query.paymentId, query.limit ? { limit: query.limit } : undefined);
    reply.status(200).send(refunds);
  });
}
