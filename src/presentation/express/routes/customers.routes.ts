import type { Router } from 'express';
import type { Payable } from '../../../payable';
import {
  billableLookupSchema,
  customerBodySchema,
  customerSyncBodySchema,
  customerUpdateBodySchema,
  parseBody,
} from '../../shared/schemas';
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

export function registerCustomerRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.post(
    '/customers',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(customerBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const customer = await payable.customers(undefined, tenantId).create(body.billable);
      res.status(201).json(customer);
    }),
  );

  router.patch(
    '/customers',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(customerUpdateBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const customer = await payable
        .customers(undefined, tenantId)
        .update(body.billable, { email: body.email, name: body.name });
      res.status(200).json(customer);
    }),
  );

  router.post(
    '/customers/sync',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(customerSyncBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const providerCustomerId = await payable
        .customers(body.provider, tenantId)
        .sync(body.billable);
      res.status(200).json({ providerCustomerId });
    }),
  );

  router.get(
    '/customers',
    asyncHandler(async (req, res) => {
      const query = parseBody(billableLookupSchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const customer = await payable.customers(undefined, tenantId).get({ ...query });
      if (!customer) {
        res.status(404).json({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
        return;
      }
      res.status(200).json(customer);
    }),
  );
}
