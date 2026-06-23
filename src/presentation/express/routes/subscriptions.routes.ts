import type { Router } from 'express';
import type { Payable } from '../../../payable';
import {
  manageSubscriptionBodySchema,
  parseBody,
  swapSubscriptionBodySchema,
} from '../../shared/schemas';
import { asyncHandler, jsonBody } from '../helpers';

type ManageAction = 'cancel' | 'cancelNow' | 'resume';

export function registerSubscriptionRoutes(router: Router, payable: Payable): void {
  const manage = (action: ManageAction) =>
    asyncHandler(async (req, res) => {
      const body = parseBody(manageSubscriptionBodySchema, req.body);
      const manager = payable.customer(body.billable).subscription(String(req.params.name));
      res.status(200).json(await manager[action]());
    });

  router.post('/subscriptions/:name/cancel', jsonBody(), manage('cancel'));
  router.post('/subscriptions/:name/cancel-now', jsonBody(), manage('cancelNow'));
  router.post('/subscriptions/:name/resume', jsonBody(), manage('resume'));
  router.post(
    '/subscriptions/:name/swap',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(swapSubscriptionBodySchema, req.body);
      const manager = payable.customer(body.billable).subscription(String(req.params.name));
      res.status(200).json(await manager.swap(body.price));
    }),
  );
}
