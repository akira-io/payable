import type { Router } from 'express';
import type { Payable } from '../../../payable';
import {
  type ManageSubscriptionAction as ManageAction,
  runManageSubscription,
  runSwapSubscription,
} from '../../shared/operations';
import {
  billableLookupSchema,
  listSubscriptionsQuerySchema,
  manageSubscriptionBodySchema,
  parseBody,
  swapSubscriptionBodySchema,
} from '../../shared/schemas';
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

export function registerSubscriptionRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  router.get(
    '/subscriptions',
    asyncHandler(async (req, res) => {
      const query = parseBody(listSubscriptionsQuerySchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const subscriptions = await payable
        .customer(
          { billableType: query.billableType, billableId: query.billableId },
          undefined,
          tenantId,
        )
        .subscriptions(query.limit ? { limit: query.limit } : undefined);
      res.status(200).json(subscriptions);
    }),
  );

  router.get(
    '/subscriptions/:name',
    asyncHandler(async (req, res) => {
      const query = parseBody(billableLookupSchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const subscription = await payable
        .customer({ ...query }, undefined, tenantId)
        .subscription(String(req.params.name))
        .get();
      if (!subscription) {
        res
          .status(404)
          .json({ error: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' });
        return;
      }
      res.status(200).json(subscription);
    }),
  );

  const manage = (action: ManageAction) =>
    asyncHandler(async (req, res) => {
      const body = parseBody(manageSubscriptionBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const result = await runManageSubscription(
        payable,
        action,
        String(req.params.name),
        body.billable,
        tenantId,
        options.resolveAuthorization?.(req),
      );
      res.status(200).json(result);
    });

  router.post('/subscriptions/:name/cancel', jsonBody(), manage('cancel'));
  router.post('/subscriptions/:name/cancel-now', jsonBody(), manage('cancelNow'));
  router.post('/subscriptions/:name/resume', jsonBody(), manage('resume'));
  router.post(
    '/subscriptions/:name/swap',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(swapSubscriptionBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const result = await runSwapSubscription(
        payable,
        String(req.params.name),
        body,
        tenantId,
        options.resolveAuthorization?.(req),
      );
      res.status(200).json(result);
    }),
  );
}
