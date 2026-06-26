import type { FastifyInstance } from 'fastify';
import type { Payable } from '../../../payable';
import {
  parseBody,
  parseMoneyInput,
  priceBodySchema,
  productBodySchema,
  productUpdateBodySchema,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

export async function registerCatalogRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  const writeOptions = {
    bodyLimit: DEFAULT_BODY_LIMIT,
    config: { rateLimit: options.rateLimit ?? DEFAULT_ROUTE_RATE_LIMIT },
  };

  scope.post('/products', writeOptions, async (request, reply) => {
    const body = parseBody(productBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply.status(201).send(await payable.products(undefined, tenantId).create(body));
  });

  scope.patch('/products', writeOptions, async (request, reply) => {
    const body = parseBody(productUpdateBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply.status(200).send(await payable.products(undefined, tenantId).update(body));
  });

  scope.post('/prices', writeOptions, async (request, reply) => {
    const body = parseBody(priceBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const price = await payable.prices(undefined, tenantId).create({
      providerProductId: body.providerProductId,
      unitAmount: parseMoneyInput(body.amount),
      interval: body.interval,
      intervalCount: body.intervalCount,
      description: body.description,
    });
    reply.status(201).send(price);
  });
}
