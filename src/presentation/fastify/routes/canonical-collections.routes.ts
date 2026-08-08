import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Payable } from '../../../payable';
import {
  canonicalCustomerListQuerySchema,
  canonicalPaymentListQuerySchema,
  canonicalPriceListQuerySchema,
  canonicalProductListQuerySchema,
  canonicalSubscriptionListQuerySchema,
  catalogIdParamSchema,
  parseBody,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';

export async function registerCanonicalCollectionRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  scope.get('/canonical/customers', async (request, reply) => {
    const input = parseBody(canonicalCustomerListQuerySchema, request.query);
    reply
      .status(200)
      .send(await payable.customers(undefined, tenantOf(request, options)).list(input));
  });
  scope.get('/canonical/customers/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const customer = await payable.customers(undefined, tenantOf(request, options)).find(id);
    if (!customer) {
      reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
      return;
    }
    reply.status(200).send(customer);
  });

  scope.get('/canonical/products', async (request, reply) => {
    const input = parseBody(canonicalProductListQuerySchema, request.query);
    reply.status(200).send(await payable.products(tenantOf(request, options)).list(input));
  });
  scope.get('/canonical/products/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    reply.status(200).send(await payable.products(tenantOf(request, options)).retrieve(id));
  });

  scope.get('/canonical/prices', async (request, reply) => {
    const input = parseBody(canonicalPriceListQuerySchema, request.query);
    reply.status(200).send(await payable.prices(tenantOf(request, options)).list(input));
  });
  scope.get('/canonical/prices/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    reply.status(200).send(await payable.prices(tenantOf(request, options)).retrieve(id));
  });

  scope.get('/canonical/subscriptions', async (request, reply) => {
    const input = parseBody(canonicalSubscriptionListQuerySchema, request.query);
    reply
      .status(200)
      .send(await payable.canonicalSubscriptions(tenantOf(request, options)).list(input));
  });
  scope.get('/canonical/subscriptions/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    reply
      .status(200)
      .send(await payable.canonicalSubscriptions(tenantOf(request, options)).retrieve(id));
  });

  scope.get('/canonical/payments', async (request, reply) => {
    const input = parseBody(canonicalPaymentListQuerySchema, request.query);
    reply.status(200).send(await payable.storedPayments(tenantOf(request, options)).list(input));
  });
  scope.get('/canonical/payments/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    reply.status(200).send(await payable.storedPayments(tenantOf(request, options)).retrieve(id));
  });
}

function tenantOf(request: FastifyRequest, options: FastifyPayableOptions): string | null {
  return options.resolveTenant?.(request) ?? null;
}
