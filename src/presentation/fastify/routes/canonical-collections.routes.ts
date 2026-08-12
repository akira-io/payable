import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Money } from '../../../domain/value-objects/money';
import type { Payable } from '../../../payable';
import { requireRequestIdempotencyKey } from '../../shared/catalog-idempotency';
import {
  canonicalCustomerListQuerySchema,
  canonicalPaymentListQuerySchema,
  canonicalPriceListQuerySchema,
  canonicalProductListQuerySchema,
  canonicalRefundListQuerySchema,
  canonicalSubscriptionListQuerySchema,
  catalogIdParamSchema,
  localPaymentBodySchema,
  localRefundBodySchema,
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
  scope.get('/canonical/refunds', async (request, reply) => {
    const input = parseBody(canonicalRefundListQuerySchema, request.query);
    reply
      .status(200)
      .send(await payable.storedPayments(tenantOf(request, options)).listRefunds(input));
  });
  scope.get('/canonical/refunds/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    reply
      .status(200)
      .send(await payable.storedPayments(tenantOf(request, options)).retrieveRefund(id));
  });
  scope.post('/canonical/payments/local', async (request, reply) => {
    const body = parseBody(localPaymentBodySchema, request.body);
    const payment = await payable.storedPayments(tenantOf(request, options)).record({
      ...body,
      amount: Money.of(body.amount, body.currency),
      authorization: options.resolveAuthorization?.(request),
      idempotencyKey: requestIdempotencyKey(request),
    });
    reply.status(201).send(payment);
  });
  scope.post('/canonical/payments/:id/refunds/local', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const body = parseBody(localRefundBodySchema, request.body);
    const refund = await payable.storedPayments(tenantOf(request, options)).refundLocal(id, {
      ...body,
      amount:
        body.amount === undefined ? undefined : Money.of(body.amount, body.currency as string),
      authorization: options.resolveAuthorization?.(request),
      idempotencyKey: requestIdempotencyKey(request),
    });
    reply.status(201).send(refund);
  });
  scope.post('/canonical/payments/:id/succeed', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    reply.status(200).send(
      await payable.storedPayments(tenantOf(request, options)).succeed(id, {
        authorization: options.resolveAuthorization?.(request),
        idempotencyKey: requestIdempotencyKey(request),
      }),
    );
  });
  scope.post('/canonical/payments/:id/void', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    reply.status(200).send(
      await payable.storedPayments(tenantOf(request, options)).void(id, {
        authorization: options.resolveAuthorization?.(request),
        idempotencyKey: requestIdempotencyKey(request),
      }),
    );
  });
}

function tenantOf(request: FastifyRequest, options: FastifyPayableOptions): string | null {
  return options.resolveTenant?.(request) ?? null;
}

function requestIdempotencyKey(request: FastifyRequest): string {
  return requireRequestIdempotencyKey({
    headers: request.headers,
    rawHeaders: request.raw.rawHeaders,
  });
}
