import type { Request, Router } from 'express';
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
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

function mutationOptionsFor(
  request: Request,
  options: ExpressPayableOptions,
): CatalogMutationOptions {
  return {
    authorization: options.resolveAuthorization?.(request),
    idempotencyKey: resolveCatalogIdempotencyHeader({
      headers: request.headers,
      rawHeaders: request.rawHeaders,
    }),
  };
}

export function registerCatalogRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.get(
    '/products',
    asyncHandler(async (req, res) => {
      const query = parseBody(catalogListQuerySchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res.status(200).json(await payable.providerCatalog(undefined, tenantId).products.list(query));
    }),
  );

  router.get(
    '/products/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res
        .status(200)
        .json(await payable.providerCatalog(undefined, tenantId).products.retrieve(id));
    }),
  );

  router.post(
    '/products/:id/activate',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res
        .status(200)
        .json(
          await payable
            .providerCatalog(undefined, tenantId)
            .products.activate(id, mutationOptionsFor(req, options)),
        );
    }),
  );

  router.post(
    '/products/:id/archive',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res
        .status(200)
        .json(
          await payable
            .providerCatalog(undefined, tenantId)
            .products.archive(id, mutationOptionsFor(req, options)),
        );
    }),
  );

  router.post(
    '/products',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(productBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const product = await payable
        .providerCatalog(undefined, tenantId)
        .products.create(body, mutationOptionsFor(req, options));
      res.status(201).json(product);
    }),
  );

  router.patch(
    '/products',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(productUpdateBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const product = await payable
        .providerCatalog(undefined, tenantId)
        .products.update(body, mutationOptionsFor(req, options));
      res.status(200).json(product);
    }),
  );

  router.post(
    '/prices',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(priceBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const price = await payable.providerCatalog(undefined, tenantId).prices.create(
        {
          providerProductId: body.providerProductId,
          unitAmount: parseMoneyInput(body.amount),
          interval: body.interval,
          intervalCount: body.intervalCount,
          description: body.description,
        },
        mutationOptionsFor(req, options),
      );
      res.status(201).json(price);
    }),
  );

  router.get(
    '/prices',
    asyncHandler(async (req, res) => {
      const query = parseBody(priceListQuerySchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res.status(200).json(await payable.providerCatalog(undefined, tenantId).prices.list(query));
    }),
  );

  router.get(
    '/prices/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res.status(200).json(await payable.providerCatalog(undefined, tenantId).prices.retrieve(id));
    }),
  );

  router.post(
    '/prices/:id/activate',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res
        .status(200)
        .json(
          await payable
            .providerCatalog(undefined, tenantId)
            .prices.activate(id, mutationOptionsFor(req, options)),
        );
    }),
  );

  router.post(
    '/prices/:id/archive',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const tenantId = options.resolveTenant?.(req) ?? null;
      res
        .status(200)
        .json(
          await payable
            .providerCatalog(undefined, tenantId)
            .prices.archive(id, mutationOptionsFor(req, options)),
        );
    }),
  );
}
