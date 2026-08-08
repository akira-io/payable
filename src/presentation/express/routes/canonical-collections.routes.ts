import type { Router } from 'express';
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
import { asyncHandler, type ExpressPayableOptions } from '../helpers';

export function registerCanonicalCollectionRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.get(
    '/canonical/customers',
    asyncHandler(async (req, res) => {
      const input = parseBody(canonicalCustomerListQuerySchema, req.query);
      res.status(200).json(await payable.customers(undefined, tenantOf(req, options)).list(input));
    }),
  );
  router.get(
    '/canonical/customers/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const customer = await payable.customers(undefined, tenantOf(req, options)).find(id);
      if (!customer) {
        res.status(404).json({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
        return;
      }
      res.status(200).json(customer);
    }),
  );

  router.get(
    '/canonical/products',
    asyncHandler(async (req, res) => {
      const input = parseBody(canonicalProductListQuerySchema, req.query);
      res.status(200).json(await payable.products(tenantOf(req, options)).list(input));
    }),
  );
  router.get(
    '/canonical/products/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      res.status(200).json(await payable.products(tenantOf(req, options)).retrieve(id));
    }),
  );

  router.get(
    '/canonical/prices',
    asyncHandler(async (req, res) => {
      const input = parseBody(canonicalPriceListQuerySchema, req.query);
      res.status(200).json(await payable.prices(tenantOf(req, options)).list(input));
    }),
  );
  router.get(
    '/canonical/prices/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      res.status(200).json(await payable.prices(tenantOf(req, options)).retrieve(id));
    }),
  );

  router.get(
    '/canonical/subscriptions',
    asyncHandler(async (req, res) => {
      const input = parseBody(canonicalSubscriptionListQuerySchema, req.query);
      res
        .status(200)
        .json(await payable.canonicalSubscriptions(tenantOf(req, options)).list(input));
    }),
  );
  router.get(
    '/canonical/subscriptions/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      res
        .status(200)
        .json(await payable.canonicalSubscriptions(tenantOf(req, options)).retrieve(id));
    }),
  );

  router.get(
    '/canonical/payments',
    asyncHandler(async (req, res) => {
      const input = parseBody(canonicalPaymentListQuerySchema, req.query);
      res.status(200).json(await payable.storedPayments(tenantOf(req, options)).list(input));
    }),
  );
  router.get(
    '/canonical/payments/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      res.status(200).json(await payable.storedPayments(tenantOf(req, options)).retrieve(id));
    }),
  );
}

function tenantOf(
  request: Parameters<NonNullable<ExpressPayableOptions['resolveTenant']>>[0],
  options: ExpressPayableOptions,
): string | null {
  return options.resolveTenant?.(request) ?? null;
}
