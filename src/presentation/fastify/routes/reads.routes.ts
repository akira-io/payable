import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import { billableLookupSchema, listInvoicesQuerySchema, parseBody } from '../../shared/schemas';
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
}
