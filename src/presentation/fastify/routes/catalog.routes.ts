import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CatalogMutationOptions } from '../../../application/builders/catalog-mutation-options';
import type { Payable } from '../../../payable';
import { resolveCatalogIdempotencyHeader } from '../../shared/catalog-idempotency';
import {
  catalogIdParamSchema,
  catalogListQuerySchema,
  parseBody,
  parseMoneyInput,
  priceBodySchema,
  priceListQuerySchema,
  productBodySchema,
  productUpdateBodySchema,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

function mutationOptionsFor(
  request: FastifyRequest,
  options: FastifyPayableOptions,
): CatalogMutationOptions {
  return {
    authorization: options.resolveAuthorization?.(request),
    idempotencyKey: resolveCatalogIdempotencyHeader({
      headers: request.headers,
      rawHeaders: request.raw.rawHeaders,
    }),
  };
}

export async function registerCatalogRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  const writeOptions = {
    bodyLimit: DEFAULT_BODY_LIMIT,
    config: { rateLimit: options.rateLimit ?? DEFAULT_ROUTE_RATE_LIMIT },
  };

  scope.get('/products', async (request, reply) => {
    const query = parseBody(catalogListQuerySchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply.status(200).send(await payable.products(undefined, tenantId).list(query));
  });

  scope.get('/products/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply.status(200).send(await payable.products(undefined, tenantId).retrieve(id));
  });

  scope.post('/products/:id/activate', writeOptions, async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply
      .status(200)
      .send(
        await payable
          .products(undefined, tenantId)
          .activate(id, mutationOptionsFor(request, options)),
      );
  });

  scope.post('/products/:id/archive', writeOptions, async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply
      .status(200)
      .send(
        await payable
          .products(undefined, tenantId)
          .archive(id, mutationOptionsFor(request, options)),
      );
  });

  scope.post('/products', writeOptions, async (request, reply) => {
    const body = parseBody(productBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply
      .status(201)
      .send(
        await payable
          .products(undefined, tenantId)
          .create(body, mutationOptionsFor(request, options)),
      );
  });

  scope.patch('/products', writeOptions, async (request, reply) => {
    const body = parseBody(productUpdateBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply
      .status(200)
      .send(
        await payable
          .products(undefined, tenantId)
          .update(body, mutationOptionsFor(request, options)),
      );
  });

  scope.post('/prices', writeOptions, async (request, reply) => {
    const body = parseBody(priceBodySchema, request.body);
    const tenantId = options.resolveTenant?.(request) ?? null;
    const price = await payable.prices(undefined, tenantId).create(
      {
        providerProductId: body.providerProductId,
        unitAmount: parseMoneyInput(body.amount),
        interval: body.interval,
        intervalCount: body.intervalCount,
        description: body.description,
      },
      mutationOptionsFor(request, options),
    );
    reply.status(201).send(price);
  });

  scope.get('/prices', async (request, reply) => {
    const query = parseBody(priceListQuerySchema, request.query);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply.status(200).send(await payable.prices(undefined, tenantId).list(query));
  });

  scope.get('/prices/:id', async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply.status(200).send(await payable.prices(undefined, tenantId).retrieve(id));
  });

  scope.post('/prices/:id/activate', writeOptions, async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply
      .status(200)
      .send(
        await payable
          .prices(undefined, tenantId)
          .activate(id, mutationOptionsFor(request, options)),
      );
  });

  scope.post('/prices/:id/archive', writeOptions, async (request, reply) => {
    const { id } = parseBody(catalogIdParamSchema, request.params);
    const tenantId = options.resolveTenant?.(request) ?? null;
    reply
      .status(200)
      .send(
        await payable.prices(undefined, tenantId).archive(id, mutationOptionsFor(request, options)),
      );
  });
}
