import type { Router } from 'express';
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
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

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
    '/canonical/refunds',
    asyncHandler(async (req, res) => {
      const input = parseBody(canonicalRefundListQuerySchema, req.query);
      res.status(200).json(await payable.storedPayments(tenantOf(req, options)).listRefunds(input));
    }),
  );
  router.get(
    '/canonical/refunds/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      res.status(200).json(await payable.storedPayments(tenantOf(req, options)).retrieveRefund(id));
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
  router.post(
    '/canonical/payments/local',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(localPaymentBodySchema, req.body);
      const payment = await payable.storedPayments(tenantOf(req, options)).record({
        ...body,
        amount: Money.of(body.amount, body.currency),
        authorization: options.resolveAuthorization?.(req),
        idempotencyKey: requestIdempotencyKey(req),
      });
      res.status(201).json(payment);
    }),
  );
  router.post(
    '/canonical/payments/:id/refunds/local',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const { id } = parseBody(catalogIdParamSchema, req.params);
      const body = parseBody(localRefundBodySchema, req.body);
      const refund = await payable.storedPayments(tenantOf(req, options)).refundLocal(id, {
        ...body,
        amount:
          body.amount === undefined ? undefined : Money.of(body.amount, body.currency as string),
        authorization: options.resolveAuthorization?.(req),
        idempotencyKey: requestIdempotencyKey(req),
      });
      res.status(201).json(refund);
    }),
  );
  for (const operation of ['succeed', 'void'] as const) {
    router.post(
      `/canonical/payments/:id/${operation}`,
      asyncHandler(async (req, res) => {
        const { id } = parseBody(catalogIdParamSchema, req.params);
        res.status(200).json(
          await payable.storedPayments(tenantOf(req, options))[operation](id, {
            authorization: options.resolveAuthorization?.(req),
            idempotencyKey: requestIdempotencyKey(req),
          }),
        );
      }),
    );
  }
}

function requestIdempotencyKey(
  request: Parameters<NonNullable<ExpressPayableOptions['resolveTenant']>>[0],
) {
  return requireRequestIdempotencyKey({ headers: request.headers, rawHeaders: request.rawHeaders });
}

function tenantOf(
  request: Parameters<NonNullable<ExpressPayableOptions['resolveTenant']>>[0],
  options: ExpressPayableOptions,
): string | null {
  return options.resolveTenant?.(request) ?? null;
}
