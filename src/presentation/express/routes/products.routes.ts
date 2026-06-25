import type { Router } from 'express';
import type { Payable } from '../../../payable';
import {
  parseBody,
  parseMoneyInput,
  priceBodySchema,
  productBodySchema,
  productUpdateBodySchema,
} from '../../shared/schemas';
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

export function registerCatalogRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.post(
    '/products',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(productBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const product = await payable.products(undefined, tenantId).create(body);
      res.status(201).json(product);
    }),
  );

  router.patch(
    '/products',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(productUpdateBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const product = await payable.products(undefined, tenantId).update(body);
      res.status(200).json(product);
    }),
  );

  router.post(
    '/prices',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(priceBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const price = await payable.prices(undefined, tenantId).create({
        providerProductId: body.providerProductId,
        unitAmount: parseMoneyInput(body.amount),
        interval: body.interval,
        intervalCount: body.intervalCount,
        description: body.description,
      });
      res.status(201).json(price);
    }),
  );
}
