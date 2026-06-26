import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import { safeContentDispositionFilename } from '../../shared/payable-http';
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
        { billableType: query.billableType, billableId: query.billableId },
        undefined,
        tenantId,
      )
      .invoices(query.limit);
    reply.status(200).send(invoices);
  });

  scope.get('/invoices/:id/pdf', async (request, reply) => {
    const tenantId = options.resolveTenant?.(request) ?? null;
    const id = String((request.params as { id: string }).id);
    const billable = parseBody(billableLookupSchema, request.query);
    const pdf = await payable.invoices(undefined, tenantId).downloadPdf(id, billable);
    const filename = safeContentDispositionFilename(pdf.filename);
    reply
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(Buffer.from(pdf.content));
  });

  scope.get('/payments', async (request, reply) => {
    const query = parseBody(billableLookupSchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const payments = await payable.customer({ ...query }, undefined, tenantId).payments();
    reply.status(200).send(payments);
  });

  scope.get('/subscriptions', async (request, reply) => {
    const query = parseBody(listSubscriptionsQuerySchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const subscriptions = await payable
      .customer(
        { billableType: query.billableType, billableId: query.billableId },
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
      .customer({ ...query }, undefined, tenantId)
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
