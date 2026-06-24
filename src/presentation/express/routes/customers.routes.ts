import type { Router } from 'express';
import type { Payable } from '../../../payable';
import {
  billableLookupSchema,
  customerBodySchema,
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

  router.get(
    '/customers',
    asyncHandler(async (req, res) => {
      const query = parseBody(billableLookupSchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const customer = await payable.customers(undefined, tenantId).get({ ...query, email: '' });
      if (!customer) {
        res.status(404).json({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
        return;
      }
      res.status(200).json(customer);
    }),
  );
}
