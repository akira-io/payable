import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import {
  billableLookupSchema,
  customerBodySchema,
  customerUpdateBodySchema,
  parseBody,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

export async function registerCustomerRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  const writeOptions = {
    bodyLimit: DEFAULT_BODY_LIMIT,
    config: { rateLimit: options.rateLimit ?? DEFAULT_ROUTE_RATE_LIMIT },
  };

  scope.post('/customers', writeOptions, async (request, reply) => {
    const body = parseBody(customerBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const customer = await payable.customers(undefined, tenantId).create(body.billable);
    reply.status(201).send(customer);
  });

  scope.patch('/customers', writeOptions, async (request, reply) => {
    const body = parseBody(customerUpdateBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const customer = await payable
      .customers(undefined, tenantId)
      .update(body.billable, { email: body.email, name: body.name });
    reply.status(200).send(customer);
  });

  scope.get('/customers', async (request, reply) => {
    const query = parseBody(billableLookupSchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const customer = await payable.customers(undefined, tenantId).get({ ...query });
    if (!customer) {
      reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
      return;
    }
    reply.status(200).send(customer);
  });
}
